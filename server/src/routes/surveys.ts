import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../database';
import { Survey, CreateSurveyDTO, UpdateSurveyDTO } from '../models/survey';
import { generateSurveyPDF } from '../services/pdfGenerator';
import path from 'path';
import fs from 'fs';

const router = Router();

interface DBSurvey {
  id: string;
  customer_info: string;
  answers: string;
  total_price: number;
  status: string;
  admin_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
  document_generated_at: string | null;
}

// Helper to convert DB row to Survey object
const dbToSurvey = (row: DBSurvey): Survey => ({
  id: row.id,
  customerInfo: JSON.parse(row.customer_info),
  answers: JSON.parse(row.answers),
  totalPrice: row.total_price,
  status: row.status as Survey['status'],
  adminNotes: row.admin_notes || undefined,
  createdAt: row.created_at,
  reviewedAt: row.reviewed_at || undefined,
  documentGeneratedAt: row.document_generated_at || undefined,
});

// Get statistics - must be before /:id route
router.get('/stats/overview', (_req: Request, res: Response) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM surveys').get() as { count: number };
    const pending = db.prepare("SELECT COUNT(*) as count FROM surveys WHERE status = 'pending'").get() as { count: number };
    const approved = db.prepare("SELECT COUNT(*) as count FROM surveys WHERE status = 'approved'").get() as { count: number };
    const rejected = db.prepare("SELECT COUNT(*) as count FROM surveys WHERE status = 'rejected'").get() as { count: number };
    const totalRevenue = db.prepare("SELECT COALESCE(SUM(total_price), 0) as sum FROM surveys WHERE status = 'approved'").get() as { sum: number };

    res.json({
      total: total.count,
      pending: pending.count,
      approved: approved.count,
      rejected: rejected.count,
      totalRevenue: totalRevenue.sum,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: '통계를 불러오는데 실패했습니다.' });
  }
});

// Get all surveys (for admin)
router.get('/', (req: Request, res: Response) => {
  try {
    const status = req.query.status as string;
    let query = 'SELECT * FROM surveys ORDER BY created_at DESC';
    let params: string[] = [];

    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      query = 'SELECT * FROM surveys WHERE status = ? ORDER BY created_at DESC';
      params = [status];
    }

    const rows = db.prepare(query).all(...params) as DBSurvey[];
    const surveys = rows.map(dbToSurvey);

    res.json(surveys);
  } catch (error) {
    console.error('Error fetching surveys:', error);
    res.status(500).json({ error: '설문 목록을 불러오는데 실패했습니다.' });
  }
});

// Get single survey
router.get('/:id', (req: Request, res: Response) => {
  try {
    const row = db.prepare('SELECT * FROM surveys WHERE id = ?').get(req.params.id) as DBSurvey | undefined;

    if (!row) {
      return res.status(404).json({ error: '설문을 찾을 수 없습니다.' });
    }

    res.json(dbToSurvey(row));
  } catch (error) {
    console.error('Error fetching survey:', error);
    res.status(500).json({ error: '설문을 불러오는데 실패했습니다.' });
  }
});

// Create new survey (customer submission)
router.post('/', (req: Request, res: Response) => {
  try {
    const data: CreateSurveyDTO = req.body;

    // Validation
    if (!data.customerInfo || !data.customerInfo.email || !data.answers) {
      return res.status(400).json({ error: '필수 항목을 입력해주세요.' });
    }

    const id = uuidv4();
    const stmt = db.prepare(`
      INSERT INTO surveys (id, customer_info, answers, total_price)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      id,
      JSON.stringify(data.customerInfo),
      JSON.stringify(data.answers),
      data.totalPrice || 0
    );

    res.status(201).json({ id, message: '설문이 성공적으로 제출되었습니다.' });
  } catch (error) {
    console.error('Error creating survey:', error);
    res.status(500).json({ error: '설문 제출에 실패했습니다.' });
  }
});

// Update survey status (admin review)
router.patch('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data: UpdateSurveyDTO = req.body;

    const existing = db.prepare('SELECT * FROM surveys WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: '설문을 찾을 수 없습니다.' });
    }

    const updates: string[] = [];
    const values: (string | null)[] = [];

    if (data.status) {
      updates.push('status = ?');
      values.push(data.status);
      updates.push('reviewed_at = CURRENT_TIMESTAMP');
    }

    if (data.adminNotes !== undefined) {
      updates.push('admin_notes = ?');
      values.push(data.adminNotes);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: '업데이트할 내용이 없습니다.' });
    }

    values.push(id);
    const query = `UPDATE surveys SET ${updates.join(', ')} WHERE id = ?`;
    db.prepare(query).run(...values);

    res.json({ message: '설문이 업데이트되었습니다.' });
  } catch (error) {
    console.error('Error updating survey:', error);
    res.status(500).json({ error: '설문 업데이트에 실패했습니다.' });
  }
});

// Generate PDF document
router.post('/:id/generate-pdf', async (req: Request, res: Response) => {
  try {
    const row = db.prepare('SELECT * FROM surveys WHERE id = ?').get(req.params.id) as DBSurvey | undefined;

    if (!row) {
      return res.status(404).json({ error: '설문을 찾을 수 없습니다.' });
    }

    const survey = dbToSurvey(row);
    const pdfPath = await generateSurveyPDF(survey);

    // Update document generation timestamp
    db.prepare('UPDATE surveys SET document_generated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);

    res.json({
      message: 'PDF 문서가 생성되었습니다.',
      fileName: path.basename(pdfPath)
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ error: 'PDF 생성에 실패했습니다.' });
  }
});

// Download PDF
router.get('/:id/download', (req: Request, res: Response) => {
  try {
    const row = db.prepare('SELECT * FROM surveys WHERE id = ?').get(req.params.id) as DBSurvey | undefined;

    if (!row) {
      return res.status(404).json({ error: '설문을 찾을 수 없습니다.' });
    }

    const documentsDir = path.join(__dirname, '../../documents');

    if (!fs.existsSync(documentsDir)) {
      return res.status(404).json({ error: 'PDF 파일을 찾을 수 없습니다. 먼저 문서를 생성해주세요.' });
    }

    const files = fs.readdirSync(documentsDir);
    const pdfFile = files.find((f: string) => f.startsWith(`survey_${req.params.id}`));

    if (!pdfFile) {
      return res.status(404).json({ error: 'PDF 파일을 찾을 수 없습니다. 먼저 문서를 생성해주세요.' });
    }

    res.download(path.join(documentsDir, pdfFile));
  } catch (error) {
    console.error('Error downloading PDF:', error);
    res.status(500).json({ error: 'PDF 다운로드에 실패했습니다.' });
  }
});

// Delete survey
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const result = db.prepare('DELETE FROM surveys WHERE id = ?').run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: '설문을 찾을 수 없습니다.' });
    }

    res.json({ message: '설문이 삭제되었습니다.' });
  } catch (error) {
    console.error('Error deleting survey:', error);
    res.status(500).json({ error: '설문 삭제에 실패했습니다.' });
  }
});

export default router;
