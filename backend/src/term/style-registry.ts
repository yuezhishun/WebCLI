import type { StyleDefinition } from "../types.js";

interface CellLike {
  getFgColor?: () => number;
  getBgColor?: () => number;
  isBold?: () => boolean;
  isItalic?: () => boolean;
  isUnderline?: () => boolean;
  isInverse?: () => boolean;
}

export class StyleRegistry {
  private readonly byKey = new Map<string, number>();
  private readonly styles: Record<string, StyleDefinition> = {
    "0": {
      fg: null,
      bg: null,
      bold: false,
      italic: false,
      underline: false,
      inverse: false
    }
  };

  constructor() {
    this.byKey.set(this.keyOf(this.styles["0"]), 0);
  }

  getIdForCell(cell: CellLike | undefined): number {
    if (!cell) {
      return 0;
    }

    const def: StyleDefinition = {
      fg: this.safeColor(cell, cell.getFgColor),
      bg: this.safeColor(cell, cell.getBgColor),
      bold: this.safeBool(cell, cell.isBold),
      italic: this.safeBool(cell, cell.isItalic),
      underline: this.safeBool(cell, cell.isUnderline),
      inverse: this.safeBool(cell, cell.isInverse)
    };

    const key = this.keyOf(def);
    const existing = this.byKey.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const nextId = this.byKey.size;
    this.byKey.set(key, nextId);
    this.styles[String(nextId)] = def;
    return nextId;
  }

  snapshot(): Record<string, StyleDefinition> {
    return { ...this.styles };
  }

  private keyOf(def: StyleDefinition): string {
    return `${def.fg ?? "n"}|${def.bg ?? "n"}|${def.bold ? 1 : 0}|${def.italic ? 1 : 0}|${def.underline ? 1 : 0}|${def.inverse ? 1 : 0}`;
  }

  private safeColor(cell: CellLike, getter?: () => number): number | null {
    if (!getter) {
      return null;
    }
    const value = getter.call(cell);
    return Number.isFinite(value) ? value : null;
  }

  private safeBool(cell: CellLike, getter?: () => boolean): boolean {
    return getter ? Boolean(getter.call(cell)) : false;
  }
}
