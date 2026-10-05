import { Product, Category, Order, WebsiteSettings, AdminUser } from '../types/index.js';

const API_BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');

export function getAuthToken(): string | null {
  return localStorage.getItem('sh_admin_token');
}

export function setAuthToken(token: string): void {
  localStorage.setItem('sh_admin_token', token);
}

export function removeAuthToken(): void {
  localStorage.removeItem('sh_admin_token');
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 413) {
        throw new Error(
          data.error ||
            'Upload payload is too large (Status 413: Payload Too Large). Please select a compressed file or configure Cloudinary in .env.'
        );
      }
      throw new Error(data.error || `Request failed with status ${res.status}`);
    }

    return data as T;
  } catch (err: any) {
    if (err?.message && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError'))) {
      throw new Error('Unable to connect to the atelier server. Please check your connection.');
    }
    throw err;
  }
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<{
      token: string;
      user: {
        id: string;
        email: string;
        name: string;
        role: 'admin' | 'customer' | 'super_admin';
        phone?: string;
      };
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (name: string, email: string, password: string, phone?: string) =>
    request<{
      token: string;
      user: {
        id: string;
        email: string;
        name: string;
        role: 'customer';
        phone?: string;
      };
    }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, phone }),
    }),

  forgotPassword: (email: string) =>
    request<{ success: boolean; message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  verifyAuth: () => request<{ user: AdminUser }>('/auth/verify'),

  changePassword: (data: { currentPassword: string; newPassword: string; confirmPassword?: string }) =>
    request<{ success: boolean; message: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Settings
  getSettings: () => request<WebsiteSettings>('/settings'),
  updateSettings: (settings: Partial<WebsiteSettings>) =>
    request<WebsiteSettings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  // Categories
  getCategories: () => request<Category[]>('/categories'),
  createCategory: (cat: Partial<Category>) =>
    request<Category>('/categories', {
      method: 'POST',
      body: JSON.stringify(cat),
    }),
  updateCategory: (id: string, cat: Partial<Category>) =>
    request<Category>(`/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(cat),
    }),
  deleteCategory: (id: string) =>
    request<{ success: boolean }>(`/categories/${id}`, {
      method: 'DELETE',
    }),

  // Products
  getProducts: (params?: { category?: string; saleOnly?: boolean; featuredOnly?: boolean; newOnly?: boolean }) => {
    const query = new URLSearchParams();
    if (params?.category) query.append('category', params.category);
    if (params?.saleOnly) query.append('saleOnly', 'true');
    if (params?.featuredOnly) query.append('featuredOnly', 'true');
    if (params?.newOnly) query.append('newOnly', 'true');
    const qs = query.toString();
    return request<Product[]>(`/products${qs ? `?${qs}` : ''}`);
  },
  getProductById: (id: string) => request<Product>(`/products/${id}`),
  createProduct: (product: Partial<Product>) =>
    request<Product>('/products', {
      method: 'POST',
      body: JSON.stringify(product),
    }),
  updateProduct: (id: string, product: Partial<Product>) =>
    request<Product>(`/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(product),
    }),
  deleteProduct: (id: string) =>
    request<{ success: boolean }>(`/products/${id}`, {
      method: 'DELETE',
    }),
  duplicateProduct: (id: string) =>
    request<Product>(`/products/${id}/duplicate`, {
      method: 'POST',
    }),

  // Orders
  getOrders: () => request<Order[]>('/orders'),
  getOrderById: (id: string) => request<Order>(`/orders/${id}`),
  createOrder: (order: Partial<Order>) =>
    request<Order>('/orders', {
      method: 'POST',
      body: JSON.stringify(order),
    }),
  updateOrderStatus: (id: string, status: Order['status']) =>
    request<Order>(`/orders/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),
  deleteOrder: (id: string) =>
    request<{ success: boolean }>(`/orders/${id}`, {
      method: 'DELETE',
    }),

  // Stats
  getStats: () =>
    request<{
      totalProducts: number;
      activeProducts: number;
      saleProducts: number;
      totalOrders: number;
      pendingOrders: number;
      completedOrders: number;
      totalSales: number;
      recentOrders: Order[];
      recentProducts: Product[];
    }>('/stats'),

  // Upload & Media
  uploadMedia: async (dataUrl: string, filename?: string, mediaType?: 'image' | 'video') => {
    // 1. Check if direct cloud upload signature is available to bypass serverless size limits
    try {
      const signRes = await request<{
        directUploadAvailable: boolean;
        signature?: {
          endpoint: string;
          apiKey: string;
          timestamp: number;
          signature: string;
          folder: string;
          publicId: string;
        };
      }>(`/upload/sign?mediaType=${mediaType || 'image'}&filename=${encodeURIComponent(filename || 'media')}`);

      if (signRes.directUploadAvailable && signRes.signature) {
        const { endpoint, apiKey, timestamp, signature, folder, publicId } = signRes.signature;
        const formData = new FormData();
        formData.append('file', dataUrl);
        formData.append('api_key', apiKey);
        formData.append('timestamp', timestamp.toString());
        formData.append('signature', signature);
        formData.append('folder', folder);
        formData.append('public_id', publicId);

        const cloudRes = await fetch(endpoint, {
          method: 'POST',
          body: formData,
        });

        const cloudData = await cloudRes.json().catch(() => ({}));
        if (cloudRes.ok && cloudData.secure_url) {
          return {
            url: cloudData.secure_url as string,
            publicId: cloudData.public_id as string,
            format: cloudData.format as string,
            bytes: cloudData.bytes as number,
            resourceType: (mediaType || 'image') as 'image' | 'video',
            originalFilename: filename,
          };
        }
      }
    } catch {
      // Continue to standard server upload
    }

    // 2. Standard server upload
    return request<{
      url: string;
      publicId?: string;
      format?: string;
      bytes?: number;
      resourceType: 'image' | 'video';
      originalFilename?: string;
    }>('/upload', {
      method: 'POST',
      body: JSON.stringify({ dataUrl, filename, mediaType }),
    });
  },

  uploadImage: (dataUrl: string, filename?: string) =>
    request<{ url: string; bytes?: number }>('/upload', {
      method: 'POST',
      body: JSON.stringify({ dataUrl, filename, mediaType: 'image' }),
    }),

  uploadVideo: (dataUrl: string, filename?: string) =>
    request<{ url: string; bytes?: number }>('/upload', {
      method: 'POST',
      body: JSON.stringify({ dataUrl, filename, mediaType: 'video' }),
    }),

  deleteMedia: (url: string) =>
    request<{ success: boolean }>('/upload', {
      method: 'DELETE',
      body: JSON.stringify({ url }),
    }),

  getStorageStatus: () =>
    request<{ cloudStorageActive: boolean; provider: string }>('/upload/status'),
};
