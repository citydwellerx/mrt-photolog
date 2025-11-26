
export interface Station {
  code: string;
  name: string;
}

export interface MRTLine {
  id: string;
  name: string;
  colorClass: string;
  stations: Station[];
}

export interface VisitLog {
  stationCode: string;
  visitedDate: string;
  imageData?: string;
  caption?: string;
  highlights?: string;
  goodFood?: string;
}

export type VisitMap = Record<string, VisitLog>;
