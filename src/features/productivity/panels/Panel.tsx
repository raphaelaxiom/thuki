/** Shared shell + styles for the productivity panels. Plain inline styles keep the panels self-contained. */
import type { CSSProperties, ReactNode } from 'react';

export const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 16,
  fontFamily: 'inherit',
};

export const headingStyle: CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 700,
};

export const subStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  opacity: 0.75,
};

export const rowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
};

export const inputStyle: CSSProperties = {
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid #888',
  fontSize: 14,
  background: 'inherit',
  color: 'inherit',
};

export const buttonStyle: CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid #888',
  cursor: 'pointer',
  fontSize: 14,
  background: 'inherit',
  color: 'inherit',
};

export const dangerButtonStyle: CSSProperties = {
  ...buttonStyle,
  borderColor: '#b3261e',
  color: '#b3261e',
};

export const cardStyle: CSSProperties = {
  border: '1px solid #888',
  borderRadius: 8,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

export const statusStyle: CSSProperties = { fontSize: 13, margin: 0 };

export function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section style={panelStyle} aria-label={title}>
      <h2 style={headingStyle}>{title}</h2>
      {description ? <p style={subStyle}>{description}</p> : null}
      {children}
    </section>
  );
}
