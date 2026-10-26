import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download } from 'lucide-react';
import { Modal } from '@/components/ui';

/** Shows a QR code of the profile link, with a download button. */
export const ProfileQrDialog = ({
  open,
  link,
  username,
  onClose,
}: {
  open: boolean;
  link: string;
  username: string;
  onClose: () => void;
}) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    QRCode.toDataURL(link, { width: 480, margin: 2 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, link]);

  return (
    <Modal
      open={open}
      labelledBy="profile-qr-title"
      onClose={onClose}
      className="surface-raised mx-4 w-full max-w-xs space-y-3 rounded-2xl p-6 text-center"
    >
      <h2 id="profile-qr-title" className="text-xl font-semibold">
        Scan to open @{username}
      </h2>
      {dataUrl ? (
        <img src={dataUrl} alt={`QR code for ${link}`} className="mx-auto size-56 rounded-xl" />
      ) : (
        <div className="skeleton mx-auto size-56 rounded-xl" aria-hidden="true" />
      )}
      <div className="flex justify-center gap-2">
        {dataUrl && (
          <a
            href={dataUrl}
            download={`flick-${username}-qr.png`}
            className="btn btn-primary min-h-[44px] gap-2 rounded-2xl"
          >
            <Download className="size-4" aria-hidden="true" /> Download
          </a>
        )}
        <button type="button" className="btn btn-ghost min-h-[44px] rounded-2xl" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
};
