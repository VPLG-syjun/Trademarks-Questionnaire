import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import TemplatePreviewModal from '../components/TemplatePreviewModal';

interface Template {
  id: string;
  name: string;
  displayName: string;
  category: string;
  filename: string;
  uploadedAt: string;
  isActive: boolean;
  variables?: any[];
}

const CATEGORIES = ['투자', '법인설립', '근로계약', '기타'];

interface ScanResult {
  templateId: string;
  templateName: string;
  variables: string[];
  count: number;
}

export default function TemplateManagement() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [uploading, setUploading] = useState(false);

  // 변수 스캔 상태
  const [scanning, setScanning] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [showScanModal, setShowScanModal] = useState(false);

  // 미리보기 상태
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  // 폼 상태
  const [formData, setFormData] = useState({
    name: '',
    displayName: '',
    category: '법인설립',
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/templates');
      if (!response.ok) throw new Error('템플릿 목록을 불러오는데 실패했습니다.');
      const data = await response.json();

      // 각 템플릿의 변수 개수 조회
      const templatesWithVariables = await Promise.all(
        data.map(async (template: Template) => {
          try {
            const varResponse = await fetch(`/api/templates/variables?templateId=${template.id}`);
            if (varResponse.ok) {
              const variables = await varResponse.json();
              return { ...template, variables };
            }
          } catch {
            // 변수 조회 실패 시 무시
          }
          return { ...template, variables: [] };
        })
      );

      setTemplates(templatesWithVariables);
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.docx')) {
      alert('.docx 파일만 업로드할 수 있습니다.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('파일 크기는 10MB를 초과할 수 없습니다.');
      return;
    }

    setSelectedFile(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!formData.name || !formData.displayName || !selectedFile) {
      alert('모든 필수 항목을 입력해주세요.');
      return;
    }

    setUploading(true);

    try {
      // 파일을 base64로 변환
      const fileData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // data:application/... 부분 제거
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      });

      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upload',
          name: formData.name,
          displayName: formData.displayName,
          category: formData.category,
          filename: selectedFile.name,
          fileData,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '업로드에 실패했습니다.');
      }

      alert('템플릿이 업로드되었습니다.');
      setShowModal(false);
      resetForm();
      loadTemplates();
    } catch (err) {
      alert(err instanceof Error ? err.message : '업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`"${name}" 템플릿을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/templates/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('삭제에 실패했습니다.');

      alert('템플릿이 삭제되었습니다.');
      loadTemplates();
    } catch (err) {
      alert(err instanceof Error ? err.message : '삭제에 실패했습니다.');
    }
  };

  const handleDownload = (id: string) => {
    window.open(`/api/templates/download/${id}`, '_blank');
  };

  const handleScanVariables = async (template: Template) => {
    setScanning(template.id);
    try {
      const response = await fetch('/api/templates/variables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: template.id, action: 'scan' }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '변수 스캔에 실패했습니다.');
      }

      const data = await response.json();
      setScanResult({
        templateId: template.id,
        templateName: template.displayName,
        variables: data.variables,
        count: data.count,
      });
      setShowScanModal(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : '변수 스캔에 실패했습니다.');
    } finally {
      setScanning(null);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', displayName: '', category: '법인설립' });
    setSelectedFile(null);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (loading) {
    return <div className="loading">로딩 중...</div>;
  }

  if (error) {
    return <div className="message message-error">{error}</div>;
  }

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <Link to="/admin" className="btn btn-outline">
          &larr; 대시보드로 돌아가기
        </Link>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
        <h2 style={{ color: 'var(--color-primary)', fontWeight: 700 }}>
          템플릿 관리
        </h2>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          + 새 템플릿 업로드
        </button>
      </div>

      {/* 템플릿 목록 */}
      <div className="card">
        {templates.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📄</div>
            <h3 style={{ marginBottom: '8px', color: 'var(--color-gray-700)' }}>템플릿이 없습니다</h3>
            <p>새 템플릿을 업로드해주세요.</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>템플릿 이름</th>
                  <th>화면 표시명</th>
                  <th>카테고리</th>
                  <th>변수 개수</th>
                  <th>업로드일</th>
                  <th>상태</th>
                  <th>액션</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.id}>
                    <td style={{ fontWeight: 500 }}>{template.name}</td>
                    <td>{template.displayName}</td>
                    <td>
                      <span className="status-badge" style={{
                        background: 'var(--color-gray-100)',
                        color: 'var(--color-gray-700)',
                      }}>
                        {template.category}
                      </span>
                    </td>
                    <td>{template.variables?.length || 0}개</td>
                    <td style={{ color: 'var(--color-gray-500)', fontSize: '0.9rem' }}>
                      {formatDate(template.uploadedAt)}
                    </td>
                    <td>
                      <span className={`status-badge ${template.isActive ? 'status-approved' : 'status-rejected'}`}>
                        {template.isActive ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <Link
                          to={`/admin/templates/${template.id}/edit`}
                          className="btn btn-primary"
                          style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                        >
                          편집
                        </Link>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                          onClick={() => handleScanVariables(template)}
                          disabled={scanning === template.id}
                        >
                          {scanning === template.id ? '스캔 중...' : '변수 스캔'}
                        </button>
                        <button
                          className="btn btn-outline"
                          style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                          onClick={() => {
                            setPreviewTemplate(template);
                            setShowPreviewModal(true);
                          }}
                        >
                          👁 미리보기
                        </button>
                        <button
                          className="btn btn-outline"
                          style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                          onClick={() => handleDownload(template.id)}
                        >
                          📥 다운로드
                        </button>
                        <button
                          className="btn btn-danger"
                          style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                          onClick={() => handleDelete(template.id, template.name)}
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 업로드 모달 */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>새 템플릿 업로드</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>템플릿 이름 *</label>
                <input
                  type="text"
                  placeholder="예: 투자계약서_시드"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>화면 표시명 *</label>
                <input
                  type="text"
                  placeholder="예: 투자계약서 (시드 라운드)"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>카테고리 *</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>템플릿 파일 *</label>
                <div
                  className={`file-drop-zone ${dragActive ? 'active' : ''} ${selectedFile ? 'has-file' : ''}`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".docx"
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                  />
                  {selectedFile ? (
                    <div className="file-selected">
                      <span className="file-icon">📄</span>
                      <span className="file-name">{selectedFile.name}</span>
                      <span className="file-size">({(selectedFile.size / 1024).toFixed(1)} KB)</span>
                    </div>
                  ) : (
                    <div className="file-placeholder">
                      <span className="upload-icon">📁</span>
                      <p>파일을 드래그하거나 클릭하여 업로드</p>
                      <p className="file-hint">.docx 파일, 최대 10MB</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => { setShowModal(false); resetForm(); }}
              >
                취소
              </button>
              <button
                className="btn btn-primary"
                onClick={handleUpload}
                disabled={uploading || !selectedFile || !formData.name || !formData.displayName}
              >
                {uploading ? '업로드 중...' : '업로드'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 변수 스캔 결과 모달 */}
      {showScanModal && scanResult && (
        <div className="modal-overlay" onClick={() => setShowScanModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h3>변수 스캔 결과</h3>
              <button className="modal-close" onClick={() => setShowScanModal(false)}>×</button>
            </div>

            <div className="modal-body">
              <div style={{ marginBottom: '16px' }}>
                <strong>템플릿:</strong> {scanResult.templateName}
              </div>
              <div style={{ marginBottom: '16px' }}>
                <strong>발견된 변수:</strong> {scanResult.count}개
              </div>

              {scanResult.variables.length > 0 ? (
                <div className="variable-list">
                  {scanResult.variables.map((variable, index) => (
                    <div key={index} className="variable-item">
                      <code>{`{${variable}}`}</code>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state" style={{ padding: '20px' }}>
                  <p>발견된 변수가 없습니다.</p>
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-gray-500)' }}>
                    템플릿에서 {'{변수명}'} 형식의 변수를 찾지 못했습니다.
                  </p>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                className="btn btn-primary"
                onClick={() => setShowScanModal(false)}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 템플릿 미리보기 모달 */}
      {previewTemplate && (
        <TemplatePreviewModal
          isOpen={showPreviewModal}
          onClose={() => {
            setShowPreviewModal(false);
            setPreviewTemplate(null);
          }}
          templateId={previewTemplate.id}
          templateName={previewTemplate.displayName || previewTemplate.name}
          useSampleData={true}
        />
      )}
    </div>
  );
}
