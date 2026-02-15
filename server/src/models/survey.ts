export interface SurveyAnswer {
  questionId: string;
  value: string | string[];
  price?: number;
}

export interface CustomerInfo {
  name: string;
  email: string;
  phone?: string;
  company?: string;
}

export interface Survey {
  id: string;
  customerInfo: CustomerInfo;
  answers: SurveyAnswer[];
  totalPrice: number;
  status: 'pending' | 'approved' | 'rejected';
  adminNotes?: string;
  createdAt: string;
  reviewedAt?: string;
  documentGeneratedAt?: string;
}

export interface CreateSurveyDTO {
  customerInfo: CustomerInfo;
  answers: SurveyAnswer[];
  totalPrice: number;
}

export interface UpdateSurveyDTO {
  status?: 'pending' | 'approved' | 'rejected';
  adminNotes?: string;
}
