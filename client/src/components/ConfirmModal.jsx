import React, { useEffect } from 'react';

export default function ConfirmModal({
  show,
  title = 'Confirm',
  message = 'Are you sure?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    function onKey(e) {
      if (!show) return;
      if (e.key === 'Escape') onCancel?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, onCancel]);

  if (!show) return null;
  return (
    <div className="app-modal-backdrop" role="dialog" aria-modal="true">
      <div className="app-modal card shadow">
        <div className="card-header">
          <strong>{title}</strong>
        </div>
        <div className="card-body">
          <p className="mb-0">{message}</p>
        </div>
        <div className="card-footer d-flex justify-content-end gap-2">
          <button className="btn btn-secondary" onClick={onCancel}>{cancelText}</button>
          <button className="btn btn-danger" onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}

