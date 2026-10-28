export default function ConfirmModal({ open, title, message, confirmText = 'Xóa', cancelText = 'Hủy', onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 16,
          padding: 24,
          width: '90%',
          maxWidth: 420,
          boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 12px' }}>{title}</h3>
        <p style={{ margin: '0 0 20px', color: '#444' }}>{message}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ background: '#e5e7eb', color: '#111', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer' }}
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer' }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
