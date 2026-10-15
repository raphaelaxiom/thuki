import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MenubarExtras } from '../panels/MenubarExtras';
import { DailyBriefing } from '../panels/DailyBriefing';
import { ProductivityHome } from '../panels/ProductivityHome';
import { ProductivityRoutes } from '../routes';

describe('MenubarExtras', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders engine status and recent conversations sections', async () => {
    render(<MenubarExtras />);
    expect(screen.getByText('Engine status')).toBeInTheDocument();
    expect(screen.getByText('Recent conversations')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Quick new chat' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Quit Veilura' }),
    ).toBeInTheDocument();
    // The mocked invoke resolves undefined, so both probes report unavailable.
    await waitFor(() => {
      expect(screen.getByText(/Engine status unavailable/)).toBeInTheDocument();
      expect(
        screen.getByText(/Recent conversations unavailable/),
      ).toBeInTheDocument();
    });
  });
});

describe('DailyBriefing', () => {
  it('renders an honest empty briefing', () => {
    window.localStorage.clear();
    render(<DailyBriefing />);
    expect(screen.getByText('No reminders today.')).toBeInTheDocument();
    expect(
      screen.getByText('No focus sessions logged yet today.'),
    ).toBeInTheDocument();
  });
});

describe('ProductivityHome + routes', () => {
  it('navigates between sections', () => {
    window.localStorage.clear();
    render(<ProductivityHome />);
    expect(screen.getByText('No reminders today.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reminders' }));
    expect(screen.getByLabelText('Reminder title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Audit log' }));
    expect(screen.getByText(/No audit entries yet/)).toBeInTheDocument();
  });

  it('exposes one route per panel', () => {
    expect(ProductivityRoutes).toHaveLength(14);
    const paths = ProductivityRoutes.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain('/productivity');
    expect(paths).toContain('/productivity/audit-log');
  });
});
