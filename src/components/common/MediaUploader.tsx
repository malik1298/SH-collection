import React, { useState, useRef } from 'react';
import { api } from '../../lib/api.js';
import {
  Upload,
  Image as ImageIcon,
  Video as VideoIcon,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Play,
  Film
} from 'lucide-react';

interface MediaUploaderProps {
  type: 'image' | 'video';
  value: string;
  onChange: (url: string) => void;
  label?: string;
  helperText?: string;
  className?: string;
  required?: boolean;
}

export const MediaUploader: React.FC<MediaUploaderProps> = ({
  type,
  value,
  onChange,
  label,
  helperText,
  className = '',
  required = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [fileSizeStr, setFileSizeStr] = useState<string>('');
  const [videoDuration, setVideoDuration] = useState<string>('');

  const acceptTypes =
    type === 'image'
      ? 'image/jpeg,image/png,image/webp,image/gif,image/svg+xml,image/*'
      : 'video/mp4,video/webm,video/quicktime,video/*';

  const maxBytes = type === 'image' ? 15 * 1024 * 1024 : 60 * 1024 * 1024;

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleButtonClick = () => {
    setErrorMessage(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMessage(null);
    setSelectedFileName(file.name);
    setFileSizeStr(formatFileSize(file.size));

    // Validation 1: MIME Type
    if (type === 'image' && !file.type.startsWith('image/')) {
      setErrorMessage('Please select a valid image file (JPG, PNG, WEBP, or GIF).');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (type === 'video' && !file.type.startsWith('video/')) {
      setErrorMessage('Please select a supported video file (MP4, WebM, or MOV).');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Validation 2: File Size
    if (file.size > maxBytes) {
      const maxMb = type === 'image' ? '15MB' : '100MB';
      setErrorMessage(
        `File is too large (${formatFileSize(file.size)}). Maximum permitted size is ${maxMb}.`
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsUploading(true);

    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed reading file from device.'));
        reader.readAsDataURL(file);
      });

      const res = await api.uploadMedia(dataUrl, file.name, type);
      onChange(res.url);
    } catch (err: any) {
      console.error(`${type} upload error:`, err);
      let msg = err?.message || `Failed to upload ${type}. Please try again.`;
      if (msg.includes('413') || msg.includes('Payload Too Large') || msg.includes('too large')) {
        msg = 'The video file is too large for the current transfer limit (Status 413: Payload Too Large). Please choose a compressed video clip (under 40MB) or configure Cloudinary in .env for direct CDN streaming.';
      }
      setErrorMessage(msg);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemove = () => {
    setErrorMessage(null);
    setSelectedFileName('');
    setFileSizeStr('');
    setVideoDuration('');
    onChange('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleVideoLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    if (video.duration) {
      const mins = Math.floor(video.duration / 60);
      const secs = Math.floor(video.duration % 60);
      setVideoDuration(`${mins}:${secs < 10 ? '0' : ''}${secs}`);
    }
  };

  const hasMedia = Boolean(value && value.trim());

  return (
    <div className={`space-y-2 text-xs ${className}`}>
      {label && (
        <div className="flex items-center justify-between">
          <label className="font-semibold text-[#231F20] flex items-center space-x-1.5">
            {type === 'image' ? (
              <ImageIcon className="w-3.5 h-3.5 text-[#722F37]" />
            ) : (
              <Film className="w-3.5 h-3.5 text-[#722F37]" />
            )}
            <span>{label}</span>
            {required && <span className="text-red-500 font-bold">*</span>}
          </label>
          {helperText && <span className="text-[11px] text-[#8C7654]">{helperText}</span>}
        </div>
      )}

      {/* Hidden Native File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptTypes}
        onChange={handleFileChange}
        className="hidden"
        aria-label={`Upload ${type}`}
      />

      {/* Error Notice */}
      {errorMessage && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-start space-x-2 animate-in fade-in">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div className="text-[11px] leading-tight">
            <span className="font-bold block">Upload Error</span>
            <span>{errorMessage}</span>
          </div>
        </div>
      )}

      {/* State A: No Media Selected -> Show "Choose File" Picker */}
      {!hasMedia && (
        <div
          onClick={handleButtonClick}
          className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
            isUploading
              ? 'bg-[#F5EFEB]/80 border-[#722F37] cursor-wait'
              : 'bg-[#FDFBF7] hover:bg-[#F5EFEB] border-[#D4AF37]/50 hover:border-[#722F37]'
          }`}
        >
          {isUploading ? (
            <div className="flex flex-col items-center space-y-2">
              <div className="w-8 h-8 border-3 border-[#722F37] border-t-transparent rounded-full animate-spin" />
              <span className="font-semibold text-[#722F37]">
                Processing and Uploading {type === 'image' ? 'Image' : 'Video'}...
              </span>
              <span className="text-[10px] text-[#8C7654]">
                Compressing & preparing high-definition CDN stream
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-[#722F37]/10 text-[#722F37] flex items-center justify-center shadow-xs">
                {type === 'image' ? (
                  <Upload className="w-5 h-5" />
                ) : (
                  <Film className="w-5 h-5" />
                )}
              </div>
              <div>
                <span className="font-bold text-xs text-[#231F20] block">
                  {type === 'image' ? 'Choose Image from Gallery / PC' : 'Choose Video from Gallery / PC'}
                </span>
                <span className="text-[11px] text-[#8C7654]">
                  {type === 'image'
                    ? 'Supports JPG, PNG, WEBP, GIF (Max 15MB)'
                    : 'Supports MP4, WebM, MOV (Max 100MB)'}
                </span>
              </div>
              <button
                type="button"
                className="px-4 py-2 bg-[#722F37] hover:bg-[#501F25] text-[#F4E8C1] font-bold text-xs rounded-xl shadow-xs transition-transform active:scale-95 flex items-center space-x-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{type === 'image' ? 'Select Image' : 'Select Video'}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* State B: Media Selected -> Show Live Interactive Preview & Controls */}
      {hasMedia && (
        <div className="bg-white border border-[#E8DFC9] rounded-2xl p-4 space-y-3 shadow-xs">
          <div className="flex items-center justify-between pb-2 border-b border-[#E8DFC9]/60">
            <div className="flex items-center space-x-2">
              <span className="flex items-center space-x-1 text-[11px] font-bold uppercase tracking-wider text-[#20bd5a] bg-[#25D366]/10 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="w-3 h-3" />
                <span>Ready & Loaded</span>
              </span>
              {(selectedFileName || fileSizeStr) && (
                <span className="text-[11px] text-[#8C7654] truncate max-w-xs font-mono">
                  {selectedFileName} {fileSizeStr && `(${fileSizeStr})`}
                </span>
              )}
            </div>

            {/* Action buttons: Change & Remove */}
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={handleButtonClick}
                disabled={isUploading}
                className="px-3 py-1.5 bg-[#F5EFEB] hover:bg-[#E8DFC9] text-[#722F37] rounded-xl text-xs font-semibold flex items-center space-x-1 transition-colors active:scale-95 disabled:opacity-50"
                title={`Change ${type}`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isUploading ? 'animate-spin' : ''}`} />
                <span>Change {type === 'image' ? 'Image' : 'Video'}</span>
              </button>

              <button
                type="button"
                onClick={handleRemove}
                disabled={isUploading}
                className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl text-xs font-semibold flex items-center space-x-1 transition-colors active:scale-95 disabled:opacity-50"
                title={`Remove ${type}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove</span>
              </button>
            </div>
          </div>

          {/* Media Preview Box */}
          {type === 'image' ? (
            <div className="relative rounded-xl overflow-hidden bg-[#F5EFEB] border border-[#E8DFC9] max-h-72 flex items-center justify-center">
              <img
                src={value}
                alt="Selected Preview"
                className="max-h-72 w-auto object-contain rounded-lg"
                onError={() => {
                  setErrorMessage('Failed to load image preview. The file or URL may be invalid.');
                }}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative rounded-2xl overflow-hidden bg-black/90 aspect-video max-h-80 shadow-md">
                <video
                  src={value}
                  controls
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={handleVideoLoadedMetadata}
                  className="w-full h-full object-contain"
                >
                  <source src={value} type="video/mp4" />
                  <source src={value} type="video/webm" />
                  Your browser does not support HTML5 video streaming.
                </video>
              </div>

              {videoDuration && (
                <div className="flex items-center justify-between text-[11px] text-[#8C7654] px-1">
                  <span>Duration: {videoDuration}</span>
                  <span className="text-[#20bd5a] font-semibold">HTML5 Player Verified</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
