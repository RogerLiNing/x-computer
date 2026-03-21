import { X, Download } from 'lucide-react';

interface ImagePreviewProps {
  imagePreviewUrl: string | null;
  onClose: () => void;
  onSaveImage: (src: string, name: string) => Promise<string | null>;
  onAddNotification: (notification: { type: string; title: string; message: string }) => void;
}

export function ImagePreview({ imagePreviewUrl, onClose, onSaveImage, onAddNotification }: ImagePreviewProps) {
  if (!imagePreviewUrl) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onClick={onClose}
    >
      <button
        type="button"
        className="absolute top-4 right-14 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        onClick={async (e) => {
          e.stopPropagation();
          const path = await onSaveImage(imagePreviewUrl, '生成图.png');
          if (path) onAddNotification({ type: 'info', title: '已保存到沙箱', message: path });
          else onAddNotification({ type: 'error', title: '保存失败', message: '请重试' });
        }}
        aria-label="保存"
        title="保存到沙箱"
      >
        <Download size={20} />
      </button>
      <button
        type="button"
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        onClick={onClose}
        aria-label="关闭"
      >
        <X size={20} />
      </button>
      <img
        src={imagePreviewUrl}
        alt="预览"
        className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
