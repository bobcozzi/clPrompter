/*
 * MIT License
 *
 * Copyright (c) 2026 R. Cozzi, Jr.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
  | { type: 'command' | 'keyword' | 'function' | 'variable' | 'value' | 'string' | 'symbolic_value' | 'operator'; value: string }
  | { type: 'paren_open' | 'paren_close'; value: '(' | ')' }
  | { type: 'space'; value: ' ' };

export interface CLNode {
  type: 'command_call';
  name: string;
  parameters: CLParsedParm[];
  comment?: string;  // Trailing comment like /* Copy file */
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
  | { type: 'expression'; tokens: CLToken[]; wrapped?: boolean };

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
  depConstraints?: DepConstraint[];           // Cross-parameter Dep/DepParm constraints
  valToMapToMap?: { [kwd: string]: { [val: string]: string } }; // Val→MapTo for Dep evaluation
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
  cmdLabel: string;
  cmdComment: string;
  hasProcessedFormData: boolean;
  controlsWired: boolean;
  parmMetas: ParmMetaMap;  // Include this if not already present
  touchedFields: Set<string>; // Track which fields the user has interacted with
  isInitializing: boolean; // Flag to prevent touch tracking during form initialization
  elementsToTrack: HTMLElement[]; // Elements to attach listeners to after initialization
  convertParmValueToUpperCase: boolean; // Whether to auto-convert variables, operators, and built-in functions within parameter values to uppercase
  depConstraints: DepConstraint[];  // Cross-parameter Dep/DepParm constraints
  valToMapToMap: { [kwd: string]: { [val: string]: string } }; // Val→MapTo translation map
}

// Dep/DepParm cross-parameter constraint types
export interface DepParmEntry {
  kwd: string;
  rel: string;      // EQ, NE, GT, LT, GE, LE, NL, NG, SPCFD
  cmpVal?: string;  // literal internal (MapTo) value to compare against
  cmpKwd?: string;  // keyword of another parameter to compare against
}

export interface DepConstraint {
  ctlKwdRel: string;  // ALWAYS, EQ, NE, SPCFD
  ctlKwd?: string;    // controlling keyword (absent when ALWAYS)
  cmpVal?: string;    // internal value to compare ctlKwd against
  nbrTrueRel: string; // GT, GE, EQ, LE, LT, NE
  nbrTrue: number;    // threshold count
  msgId: string;      // e.g. "CPD2830"
  depParms: DepParmEntry[];
}

// Utility types
export type ParmValue = string | string[] | (string | string[])[] | ParmValue[]; // For simple, QUAL, ELEM, multi-instance
export type ParmMap = { [kwd: string]: ParmValue };