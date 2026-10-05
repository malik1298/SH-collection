import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { db, verifyPassword, hashPassword } from './db.js';
import { processMediaUpload, deleteMediaByUrl, isCloudStorageConfigured, getUploadSignature } from './storage.js';

export const app = express();

const SESSION_SECRET = process.env.SESSION_SECRET || 'sh-collection-luxury-bridal-secret-2026';

// Store active session tokens with expiration (7 days) and user role (fallback in-memory)
const activeSessions = new Map<string, { userId: string; role: 'admin' | 'customer'; expires: number }>();

export function generateToken(userId: string, role: 'admin' | 'customer' = 'customer'): string {
  const expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ userId, role, expires })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const token = `${payload}.${signature}`;

  // Keep in memory map as well for compatibility
  activeSessions.set(token, { userId, role, expires });
  return token;
}

export function verifySessionToken(token: string): { userId: string; role: 'admin' | 'customer'; expires: number } | null {
  if (!token) return null;

  // 1. Check if token is signed stateless HMAC format: payload.signature
  const parts = token.split('.');
  if (parts.length === 2) {
    const [payloadB64, signature] = parts;
    try {
      const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('base64url');
      if (signature.length === expectedSig.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
        const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
        if (decoded && decoded.expires && decoded.expires > Date.now()) {
          return decoded;
        }
      }
    } catch {
      // invalid payload or JSON
    }
  }

  // 2. Fallback to in-memory activeSessions
  const memorySession = activeSessions.get(token);
  if (memorySession && memorySession.expires > Date.now()) {
    return memorySession;
  }

  return null;
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Admin authentication token required' });
  }

  const token = authHeader.split(' ')[1];
  const session = verifySessionToken(token);

  if (!session) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }

  if (session.role !== 'admin' && (session.role as string) !== 'super_admin') {
    return res.status(403).json({ error: 'Forbidden: Access denied. Admin privileges required.' });
  }

  (req as any).user = session;
  next();
}

// ----------------- CORS & SECURITY HEADERS -----------------
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Middlewares - Support large video file payloads up to 250MB
app.use(express.json({ limit: '250mb' }));
app.use(express.urlencoded({ extended: true, limit: '250mb' }));

// Determine safe uploads directory (handles serverless read-only filesystem)
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const UPLOADS_DIR = isServerless
  ? path.join('/tmp', 'sh-collection-uploads')
  : path.resolve(process.cwd(), 'uploads');

try {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
} catch {
  // Ignore upload dir creation error on read-only environments
}

app.use('/uploads', express.static(UPLOADS_DIR));

// ----------------- API ROUTES -----------------

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    brand: 'SH Collection',
    environment: process.env.NODE_ENV || 'production',
    timestamp: new Date().toISOString(),
  });
});

// Unified Role-Based Auth (Admin & Customer)
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const admin = db.getAdmin();
  const normInput = email.replace(/\s+/g, '').toLowerCase();
  const normDb = admin.email.replace(/\s+/g, '').toLowerCase();

  // 1. Check Admin Credentials
  const isAdminEmail =
    normInput === normDb ||
    normInput === 'shcollection@gmail.com' ||
    normInput === 'collection@gmail.com';

  if (isAdminEmail) {
    const isValidAdminPassword = verifyPassword(password, admin.passwordHash, admin.salt);
    if (!isValidAdminPassword) {
      return res.status(401).json({ error: 'Invalid credentials. Please verify your password.' });
    }

    const token = generateToken(admin.id, 'admin');
    return res.json({
      token,
      user: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: 'admin',
      },
    });
  }

  // 2. Check Customer Credentials
  const customer = db.getCustomerByEmail(email);
  if (customer) {
    const isValidCustomerPassword = verifyPassword(password, customer.passwordHash, customer.salt);
    if (!isValidCustomerPassword) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = generateToken(customer.id, 'customer');
    return res.json({
      token,
      user: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
        role: 'customer',
      },
    });
  }

  // Auto-provision demo client account for testing convenience if credentials match demo
  if (normInput === 'client@example.com' || normInput === 'ayesha@example.com') {
    const newCust = db.createCustomer('Ayesha Khan', email, password, '+92 300 9876543');
    const token = generateToken(newCust.id, 'customer');
    return res.json({
      token,
      user: {
        id: newCust.id,
        email: newCust.email,
        name: newCust.name,
        phone: newCust.phone,
        role: 'customer',
      },
    });
  }

  return res.status(401).json({ error: 'Account not found. Please register or check your login details.' });
});

// Customer Registration
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  const normInput = email.replace(/\s+/g, '').toLowerCase();
  if (normInput === 'shcollection@gmail.com' || normInput === 'collection@gmail.com') {
    return res.status(400).json({ error: 'This email is reserved for administration.' });
  }

  const existing = db.getCustomerByEmail(email);
  if (existing) {
    return res.status(400).json({ error: 'An account with this email already exists. Please sign in.' });
  }

  const customer = db.createCustomer(name, email, password, phone);
  const token = generateToken(customer.id, 'customer');
  res.status(201).json({
    token,
    user: {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      role: 'customer',
    },
  });
});

// Forgot Password
app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email address is required' });
  }

  res.json({
    success: true,
    message: 'If an account exists with this email, password reset instructions have been sent.',
  });
});

app.get('/api/auth/verify', requireAdminAuth, (_req, res) => {
  const admin = db.getAdmin();
  res.json({
    user: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
    },
  });
});

app.post('/api/auth/change-password', requireAdminAuth, (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long' });
  }

  if (confirmPassword && newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'New passwords do not match' });
  }

  const admin = db.getAdmin();
  const isValid = verifyPassword(currentPassword, admin.passwordHash, admin.salt);
  if (!isValid) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const { hash, salt } = hashPassword(newPassword);
  db.updateAdminPassword(hash, salt);
  res.json({ success: true, message: 'Password successfully updated' });
});

// Settings (Live Admin Configurations)
app.get('/api/settings', (_req, res) => {
  const settings = db.getSettings();
  res.json(settings);
});

app.put('/api/settings', requireAdminAuth, (req, res) => {
  try {
    const updated = db.updateSettings(req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update settings' });
  }
});

// Categories
app.get('/api/categories', (_req, res) => {
  const categories = db.getCategories();
  res.json(categories);
});

app.post('/api/categories', requireAdminAuth, (req, res) => {
  const { name, description, image, slug } = req.body;
  if (!name) return res.status(400).json({ error: 'Category name is required' });

  const category = db.addCategory({
    name,
    description: description || '',
    image: image || '',
    slug: slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    count: 0,
  });
  res.status(201).json(category);
});

app.delete('/api/categories/:id', requireAdminAuth, (req, res) => {
  const categoryId = req.params.id;
  if (!categoryId) return res.status(400).json({ error: 'Category ID is required' });

  const ok = db.deleteCategory(categoryId);
  if (!ok) return res.status(404).json({ error: 'Category not found or already deleted' });
  res.json({ success: true, message: 'Category deleted successfully' });
});

// Products
app.get('/api/products', (req, res) => {
  const { category, search, saleOnly, featured, newArrivals, publishedOnly, limit } = req.query;
  let products = db.getProducts({
    category: category as string,
    saleOnly: saleOnly === 'true',
    featuredOnly: featured === 'true',
    newOnly: newArrivals === 'true',
    publishedOnly: publishedOnly !== 'false',
  });

  if (search && typeof search === 'string') {
    const q = search.toLowerCase().trim();
    products = products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q)
    );
  }

  if (limit) {
    const l = parseInt(limit as string, 10);
    if (!isNaN(l) && l > 0) {
      products = products.slice(0, l);
    }
  }

  res.json(products);
});

app.get('/api/products/:id', (req, res) => {
  const product = db.getProductById(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

app.post('/api/products', requireAdminAuth, (req, res) => {
  const product = db.addProduct(req.body);
  res.status(201).json(product);
});

app.put('/api/products/:id', requireAdminAuth, (req, res) => {
  const product = db.updateProduct(req.params.id, req.body);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

app.delete('/api/products/:id', requireAdminAuth, async (req, res) => {
  const productId = req.params.id;
  if (!productId) return res.status(400).json({ error: 'Product ID is required' });

  const product = db.getProductById(productId);
  if (!product) return res.status(404).json({ error: 'Product not found or already deleted' });

  // Cleanup media associated with the product if stored locally or in cloud
  if (product.images && product.images.length > 0) {
    for (const imgUrl of product.images) {
      deleteMediaByUrl(imgUrl).catch(() => {});
    }
  }
  if (product.videos && product.videos.length > 0) {
    for (const vidUrl of product.videos) {
      deleteMediaByUrl(vidUrl).catch(() => {});
    }
  }

  const ok = db.deleteProduct(productId);
  if (!ok) return res.status(500).json({ error: 'Failed to delete product from database' });
  res.json({ success: true, message: 'Product deleted successfully' });
});

// Orders
app.get('/api/orders', requireAdminAuth, (_req, res) => {
  const orders = db.getOrders();
  res.json(orders);
});

app.get('/api/orders/:id', (req, res) => {
  const order = db.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

app.post('/api/orders', (req, res) => {
  const order = db.createOrder(req.body);
  res.status(201).json(order);
});

app.put('/api/orders/:id', requireAdminAuth, (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'Status is required' });
  const order = db.updateOrderStatus(req.params.id, status);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

app.delete('/api/orders/:id', requireAdminAuth, (req, res) => {
  const orderId = req.params.id;
  if (!orderId) return res.status(400).json({ error: 'Order ID is required' });

  const ok = db.deleteOrder(orderId);
  if (!ok) return res.status(404).json({ error: 'Order not found or already deleted' });
  res.json({ success: true, message: 'Order deleted successfully' });
});

// Dashboard Stats
app.get('/api/stats', requireAdminAuth, (_req, res) => {
  const stats = db.getStats();
  res.json(stats);
});

// Production Media Upload (Images & Videos)
app.post('/api/upload', requireAdminAuth, async (req, res) => {
  const { dataUrl, filename, mediaType } = req.body;
  if (!dataUrl) {
    return res.status(400).json({ error: 'No media data provided for upload' });
  }

  try {
    const result = await processMediaUpload(dataUrl, filename, mediaType);
    res.json(result);
  } catch (err: any) {
    console.error('Upload processing error:', err?.message || err);
    res.status(400).json({ error: err.message || 'Media upload failed' });
  }
});

// Media Deletion
app.delete('/api/upload', requireAdminAuth, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Media URL required' });
  try {
    const success = await deleteMediaByUrl(url);
    res.json({ success });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete media' });
  }
});

// Storage Provider Status
app.get('/api/upload/status', requireAdminAuth, (_req, res) => {
  res.json({
    cloudStorageActive: isCloudStorageConfigured(),
    provider: process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME ? 'cloudinary' : 'local_storage',
  });
});

// Direct Cloud Upload Signature (Bypasses serverless payload limit for large videos)
app.get('/api/upload/sign', requireAdminAuth, (req, res) => {
  const { mediaType, filename } = req.query;
  const signatureData = getUploadSignature(
    (mediaType as 'image' | 'video') || 'video',
    filename as string
  );
  res.json({
    directUploadAvailable: Boolean(signatureData),
    signature: signatureData,
  });
});

// Unhandled API routes fallback
app.all('/api/*', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Global Express error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err.status === 413 || err.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'File payload is too large. Please select a video file under 40MB or configure Cloudinary in .env for direct high-speed CDN upload.',
    });
  }

  console.error('[SH Collection Server Error]:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
});
