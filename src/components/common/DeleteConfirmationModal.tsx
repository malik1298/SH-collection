import React, { useEffect } from 'react';
import { Trash2, AlertTriangle, Loader2 } from 'lucide-react';

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  title?: string;
  itemName?: string;
  message?: string;
  isDeleting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  isOpen,
  title = 'Confirm Permanent Deletion',
  itemName,
  message,
  isDeleting = false,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) {
        onCancel();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDeleting, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={() => {
        if (!isDeleting) onCancel();
      }}
    >
      <div
        className="bg-[#FDFBF7] border border-[#E8DFC9] rounded-3xl max-w-md w-full overflow-hidden shadow-2xl relative p-6 text-center animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
      >
        {/* Warning Icon Badge */}
        <div className="mx-auto w-14 h-14 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center text-red-600 mb-4 shadow-sm">
          <Trash2 className="w-7 h-7" />
        </div>

        <h3
          id="delete-dialog-title"
          className="font-serif-luxury text-xl font-bold text-[#231F20] mb-2"
        >
          {title}
        </h3>

        <div className="text-sm text-[#5A5550] mb-6 space-y-2">
          {message ? (
            <p>{message}</p>
          ) : (
            <p>
              Are you sure you want to permanently delete{' '}
              {itemName ? (
                <strong className="text-[#231F20] font-semibold">"{itemName}"</strong>
              ) : (
                'this record'
              )}
              ? This action cannot be reversed.
            </p>
          )}

          <div className="flex items-center justify-center space-x-1.5 text-xs text-amber-700 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
            <span>The item will be permanently removed from the database.</span>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="flex-1 py-2.5 px-4 rounded-xl border border-[#D4AF37]/50 text-[#722F37] font-semibold hover:bg-[#F5EFEB] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold transition-all shadow-md hover:shadow-lg disabled:opacity-50 flex items-center justify-center space-x-2"
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Deleting...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                <span>Delete</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
