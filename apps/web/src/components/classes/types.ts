export interface ScheduleSlot {
  id?: string;
  weekday: number;
  startTime: string;
  endTime: string;
  validFrom?: string;
  room?: string | null;
}

export interface BatchSummary {
  id: string;
  name: string;
  mode: 'physical' | 'online' | 'hybrid';
  status: 'active' | 'archived';
  subjectName: string;
  teacherName: string | null;
  studentCount: number;
  schedule: ScheduleSlot[];
}

export interface BatchDetail {
  id: string;
  name: string;
  mode: 'physical' | 'online' | 'hybrid';
  status: 'active' | 'archived';
  liveUrl: string | null;
  subjectId: string;
  subjectName: string;
  teacherMembershipId: string | null;
  teacherName: string | null;
  schedule: ScheduleSlot[];
  students: { id: string; studentNumber: string; fullName: string; enrolledOn: string }[];
}

export interface Session {
  id: string;
  batchId: string;
  batchName: string;
  subjectName: string;
  teacherName: string | null;
  startsAt: string;
  endsAt: string;
  status: 'scheduled' | 'cancelled';
  note: string | null;
  isExtra: boolean;
  room: string | null;
}

export interface Member {
  membershipId: string;
  fullName: string;
  roles: string[];
}
