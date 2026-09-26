export interface CartLine {
  sku: string;
  quantity: number;
  unitCents: number;
}

/**
 * Cart maths.
 *
 * The caller keeps the cart it passed in: the basket page re-renders from the
 * same array on every keystroke, and the checkout step re-reads it after the
 * user comes back from the address form.
 */
export function applyQuantityCap(lines: CartLine[], cap: number): CartLine[] {
  for (const line of lines) {
    if (line.quantity > cap) line.quantity = cap;
  }
  return lines;
}

/** Total in cents, with the per-line rounding the invoice expects. */
export function cartTotalCents(lines: CartLine[]): number {
  return lines.reduce((total, line) => total + line.quantity * line.unitCents, 0);
}

export function emptyLines(): CartLine[] {
  return [];
}
