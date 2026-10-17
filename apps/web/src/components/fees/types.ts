export type InvoiceStatus = 'issued' | 'part_paid' | 'paid' | 'void';
export type LineKind = 'class' | 'ac' | 'tute' | 'concession' | 'admission' | 'late' | 'other';

export interface Invoice {
  id: string;
  invoiceNumber: string;
  period: string | null;
  dueDate: string;
  total: string;
  paid: string;
  status: InvoiceStatus;
  lines: { kind: LineKind; description: string; amount: string }[] | null;
}

export interface Receipt {
  id: string;
  receiptNumber: string;
  amount: string;
  method: 'cash' | 'bank_transfer' | 'slip';
  status: string;
  reference: string | null;
  receivedAt: string;
  studentId: string;
  studentNumber: string;
  studentName: string;
  receivedBy: string | null;
  allocations: {
    invoiceId: string;
    invoiceNumber: string;
    period: string | null;
    amount: string;
  }[];
}

export interface Concession {
  id: string;
  type: 'free_card' | 'half_card' | 'percent';
  percent: string;
  batchId: string | null;
  batchName: string | null;
  note: string | null;
}
