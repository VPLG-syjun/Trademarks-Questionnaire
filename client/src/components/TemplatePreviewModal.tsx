import { useState, useEffect } from 'react';
import mammoth from 'mammoth';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  templateId: string;
  templateName: string;
  surveyId?: string;
  useSampleData?: boolean;
  onConfirm?: () => void;
  showConfirmButton?: boolean;
}

const API_BASE = '/api';

export default function TemplatePreviewModal({
  isOpen,
  onClose,
  templateId,
  templateName,
  surveyId,
  useSampleData = false,
  onConfirm,
  showConfirmButton = false,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [showVariables, setShowVariables] = useState(false);
  const [usedSampleData, setUsedSampleData] = useState(false);

  useEffect(() => {
    if (isOpen && templateId) {
      loadPreview();
    }
  }, [isOpen, templateId, surveyId, useSampleData]);

  useEffect(() => {
    if (!isOpen) {
      setHtmlContent('');
      setVariables({});
      setError('');
      setShowVariables(false);
    }
  }, [isOpen]);

  const loadPreview = async () => {
    setLoading(true);
    setError('');
    setHtmlContent('');

    try {
      // 1. 서버에서 문서 생성 (미리보기용)
      const response = await fetch(`${API_BASE}/admin/preview-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId,
          surveyId: surveyId || undefined,
          useSampleData: useSampleData || !surveyId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to load preview');
      }

      const data = await response.json();
      setVariables(data.variables || {});
      setUsedSampleData(data.usedSampleData);

      // 2. Base64 → ArrayBuffer 변환
      const binaryString = atob(data.documentBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // 3. mammoth로 HTML 변환
      const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
      setHtmlContent(result.value);

      if (result.messages.length > 0) {
        console.log('Mammoth warnings:', result.messages);
      }
    } catch (err) {
      console.error('Preview error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load preview');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPreview = async () => {
    try {
      const response = await fetch(`${API_BASE}/admin/preview-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId,
          surveyId: surveyId || undefined,
          useSampleData: useSampleData || !surveyId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to download');
      }

      const data = await response.json();

      // Base64 → Blob → Download
      const binaryString = atob(data.documentBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Preview_${templateName.replace(/[^a-zA-Z0-9]/g, '_')}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError('Failed to download preview');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-preview" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="preview-header-content">
            <h2>Preview: {templateName}</h2>
            {usedSampleData && (
              <span className="preview-sample-badge">Sample Data</span>
            )}
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        {/* Body */}
        <div className="modal-body preview-body">
          {loading && (
            <div className="loading-container">
              <div className="spinner"></div>
              <p>Generating preview...</p>
            </div>
          )}

          {error && (
            <div className="preview-error">
              <div className="error-icon">⚠️</div>
              <p>{error}</p>
              <button className="btn btn-primary" onClick={loadPreview}>
                Retry
              </button>
            </div>
          )}

          {!loading && !error && htmlContent && (
            <>
              {/* Toggle Variables Button */}
              <div className="preview-toolbar">
                <button
                  className={`btn btn-sm ${showVariables ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setShowVariables(!showVariables)}
                >
                  {showVariables ? 'Hide Variables' : 'Show Variables'}
                </button>
                <button className="btn btn-sm btn-outline" onClick={handleDownloadPreview}>
                  📥 Download DOCX
                </button>
              </div>

              {/* Variables Panel */}
              {showVariables && (
                <div className="preview-variables">
                  <h4>Template Variables</h4>
                  <div className="variables-grid">
                    {Object.entries(variables).map(([key, value]) => (
                      <div key={key} className="variable-row">
                        <code>{`{${key}}`}</code>
                        <span>{value || '(empty)'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Document Preview */}
              <div
                className="preview-document"
                dangerouslySetInnerHTML={{ __html: htmlContent }}
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            {showConfirmButton ? 'Cancel' : 'Close'}
          </button>
          {showConfirmButton && onConfirm && (
            <button className="btn btn-primary" onClick={onConfirm} disabled={loading || !!error}>
              ✓ Generate This Document
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
