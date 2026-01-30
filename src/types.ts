// filepath: src/types.ts
import { CL_DATA_TYPES, CL_CONTAINER_TYPES, getTypeCategory } from './promptHelpers';

// Types used by the CL Prompter
export type ParmValues = Record<string, any>;         // For all parameter values
export type QualPartsMap = Record<string, string[]>;  // For QUAL parameter parts

export interface CLParm {
  Kwd: string;
  Type: string;
  Max?: number;
  Min?: number;
  Dft?: string;
  Quals?: CLQual[];
  Elems?: CLElem[];
}

export interface CLQual {
  Type: string;
  Prompt?: string;
  Len?: number;
  Dft?: string;
  SpcVal?: string[];
}

export interface CLElem {
  Type: string;
  Prompt?: string;
  Len?: number;
  Dft?: string;
  Quals?: CLQual[];
  Elems?: CLElem[];
}

export type CLToken =
  | { type: 'command' | 'keyword' | 'function' | 'variable' | 'value' | 'string' | 'symbolic_value'; value: string }
  | { type: 'paren_open' | 'paren_close'; value: '(' | ')' }
  | { type: 'space'; value: ' ' };

export interface CLNode {
  type: 'command_call';
  name: string;
  parameters: CLParsedParm[];
}

export interface CLParsedParm {
  name: string;
  value: CLValue;
}

export type CLValue =
  | string
  | CLNode
  | CLValue[]
  | { function: string; args: CLValue[] }
  | { type: 'expression'; tokens: CLToken[] };

export interface ParsedParms {
  [kwd: string]: string | string[] | (string | string[])[]; // Supports simple, QUAL, ELEM, multi-instance
}

// Consolidated ParmMeta (no duplicates; aligns with prompter needs)
export interface ParmMeta {
  Kwd: string;
  Type?: string;
  Max?: number;
  Quals?: { Prompt: string; Type?: string }[];
  Elems?: ElemMeta[];
  PosNbr?: number; // ← add
}

export interface ElemMeta {
  Prompt: string;
  Type?: string;
  Quals?: { Prompt: string; Type?: string }[];
  Elems?: ElemMeta[]; // Supports nested ELEMs
}

// Core XML element types (mirroring IBM i CL command XML)
export interface ParmElement extends Element {
  Kwd: string;
  Type?: string;
  Len?: string;
  Dft?: string;
  Min?: string;
  Max?: string;
  Prompt?: string;
  Constant?: string;
  Rstd?: string; // Restricted flag
  // querySelector, querySelectorAll, getAttribute inherited from Element
}

export interface ElemElement extends ParmElement {
  // Inherits from ParmElement; may contain nested Elems or Quals
}

export interface QualElement extends ParmElement {
  // Inherits; parts are Qual sub-elements
}

export interface ValueElement extends Element {
  Val: string;
  // getAttribute inherited from Element
}

export interface SpcValElement extends Element {
  // querySelectorAll inherited from Element
}

export interface CmdElement extends Element {
  CmdName?: string;
  Name?: string;
  // querySelector inherited from Element
}

// Parameter metadata from extension (consolidated)
export interface ParmMetaMap {
  [kwd: string]: {
    allowedVals?: string[];
    default?: string;
    type?: string;
    len?: number;
    restricted?: boolean;
    posNbr?: number; // ← add (numeric PosNbr from XML)
  };
}

// Webview message types
export interface FormDataMessage {
  type: 'formData';
  xml: string;
  parmMetas?: ParmMetaMap;
  allowedValsMap?: { [kwd: string]: string[] };
  cmdName?: string;
  paramMap?: { [kwd: string]: any };
  parmMap?: { [kwd: string]: any }; // Legacy support
  config?: { keywordColor?: any };
  cmdMaxPos?: number; // ← add if you have Cmd MaxPos
}

export interface SubmitMessage {
  type: 'submit';
  cmdName: string;
  values: { [kwd: string]: any };
}

export interface CancelMessage {
  type: 'cancel';
  cmdName: string;
}

export type WebviewMessage = FormDataMessage | SubmitMessage | CancelMessage | { type: string; [key: string]: any };

// Internal state
export interface PrompterState {
  xmlDoc: Document | null;
  parms: ParmElement[];
  allowedValsMap: { [kwd: string]: string[] };
  originalParmMap: { [kwd: string]: any };
  cmdName: string;
  hasProcessedFormData: boolean;
  controlsWired: boolean;
  parmMetas: ParmMetaMap;  // Include this if not already present
  touchedFields: Set<string>; // Track which fields the user has interacted with
  isInitializing: boolean; // Flag to prevent touch tracking during form initialization
  elementsToTrack: HTMLElement[]; // Elements to attach listeners to after initialization
}

// Utility types
export type ParmValue = string | string[] | (string | string[])[] | ParmValue[]; // For simple, QUAL, ELEM, multi-instance
export type ParmMap = { [kwd: string]: ParmValue };