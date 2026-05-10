# Ticket Redesign Spec - VentaDetailModal

## Goal
Redesign the sale detail ticket in `VentaDetailModal` to achieve a "Premium Digital Receipt" aesthetic. The design must be high-fidelity, professional, and accessible, moving away from literal "paper ticket" anti-patterns while keeping the iconic notched silhouette.

## Requirements
1. **Container Shape**: 
   - Notched rectangle (semi-circular cutouts on left and right edges).
   - High contrast against the modal sheet background.
   - Stronger shadows (`shadowRadius: 40`, `shadowOpacity: 0.6`) for depth.
2. **Typography**:
   - Minimum 14px for labels (MÉTODO, SUBTOTAL, IVA).
   - Minimum 18px for values.
   - Large hero typography for TOTAL PAGADO (approx. 48px).
   - Use JetBrains Mono for an industrial feel.
3. **Separators**:
   - Authentic dashed lines using actual `--------------------------` strings.
4. **Information Architecture**:
   - Folio number prominent in the header.
   - Date and Time clearly grouped and visible.
   - Removal of any "destination" or unnecessary metadata lines.
5. **Responsibility**:
   - Responsive across mobile device breakpoints.

## Approaches
- **Selected**: "Industrial Premium" - Lighter ticket surface, dark modal sheet, primary color highlights for the total, and perfectly aligned grid footer.

## Components
- `VentaDetailModal`: Main container.
- `TicketContainer`: Styled view with notches.
- `TicketFooter`: Grid-based summary.

## Verification
- Visual inspection on mobile-sized viewports.
- Typography readability check.
