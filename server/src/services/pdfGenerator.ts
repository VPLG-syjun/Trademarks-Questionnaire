import PDFDocument from 'pdfkit';
import { Survey } from '../models/survey';
import path from 'path';
import fs from 'fs';

const outputDir = path.join(__dirname, '../../documents');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

export function generateSurveyPDF(survey: Survey): Promise<string> {
  return new Promise((resolve, reject) => {
    const fileName = `survey_${survey.id}_${Date.now()}.pdf`;
    const filePath = path.join(outputDir, fileName);

    const doc = new PDFDocument({
      margin: 50,
      permissions: {
        printing: 'highResolution',
        modifying: false,
        copying: false,  // Disable text copying
        annotating: false,
        fillingForms: false,
        contentAccessibility: false,
        documentAssembly: false
      }
    });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    // Title
    doc.fontSize(24).text('Trademarks Service Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).fillColor('#666666').text('Service Agreement Summary', { align: 'center' });
    doc.moveDown(2);

    // Customer Information Section
    doc.fontSize(16).fillColor('#1e3a5f').text('Customer Information', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#000000');
    doc.text(`Name: ${survey.customerInfo.name}`);
    doc.text(`Email: ${survey.customerInfo.email}`);
    if (survey.customerInfo.phone) {
      doc.text(`Phone: ${survey.customerInfo.phone}`);
    }
    if (survey.customerInfo.company) {
      doc.text(`Company: ${survey.customerInfo.company}`);
    }
    doc.moveDown(1.5);

    // Service Summary
    doc.fontSize(16).fillColor('#1e3a5f').text('Service Summary', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#000000');
    const statusText: Record<string, string> = {
      pending: 'Pending Review',
      approved: 'Approved',
      rejected: 'Rejected'
    };
    doc.text(`Status: ${statusText[survey.status]}`);
    doc.text(`Total Price: ${survey.totalPrice.toLocaleString()} KRW`);
    doc.text(`Submitted: ${new Date(survey.createdAt).toLocaleDateString('ko-KR')}`);
    if (survey.reviewedAt) {
      doc.text(`Reviewed: ${new Date(survey.reviewedAt).toLocaleDateString('ko-KR')}`);
    }
    doc.moveDown(1.5);

    // Survey Answers Section
    doc.fontSize(16).fillColor('#1e3a5f').text('Survey Responses', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#000000');

    survey.answers.forEach((answer, index) => {
      const value = Array.isArray(answer.value) ? answer.value.join(', ') : answer.value;
      doc.font('Helvetica-Bold').text(`${index + 1}. ${answer.questionId}`);
      doc.font('Helvetica').text(`   ${value}`);
      doc.moveDown(0.5);
    });

    // Admin Notes (if any)
    if (survey.adminNotes) {
      doc.moveDown(1);
      doc.fontSize(16).fillColor('#1e3a5f').text('Admin Notes', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(12).fillColor('#000000').text(survey.adminNotes);
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(10).fillColor('#666666').text(
      `Document generated: ${new Date().toLocaleDateString('ko-KR')} ${new Date().toLocaleTimeString('ko-KR')}`,
      { align: 'center' }
    );
    doc.text('This document is confidential and for authorized use only.', { align: 'center' });

    doc.end();

    stream.on('finish', () => {
      resolve(filePath);
    });

    stream.on('error', (err) => {
      reject(err);
    });
  });
}

export function getPDFPath(fileName: string): string {
  return path.join(outputDir, fileName);
}
