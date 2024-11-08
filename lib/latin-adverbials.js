import { invert } from "./utils";

export const numbersBylatinAdverbialNumberals = {
  '': 1,
  bis: 2,
  ter: 3,
  quater: 4,
  quinquies: 5,
  sexies: 6,
  septies: 7,
  octies: 8,
  novies: 9,
  decies: 10,
  undecies: 11,
  duodecies: 12,
  'ter decies': 13,
  'quater decies': 14,
  quindecies: 15,
};

export const latinAdverbialNumberals = invert(numbersBylatinAdverbialNumberals);
