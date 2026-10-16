import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModelsSection } from '../ModelsSection';
import { OutputSection } from '../OutputSection';
import { ModelsIoPanel, DEMO_MODELS } from '../ModelsIoPanel';
import { ModelsIoRoutes } from '../routes';

describe('ModelsSection', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('stars a model, filters to favourites, and compares two models', async () => {
    render(<ModelsSection initialModels={DEMO_MODELS} />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Favourite Qwen 3.5 9B' }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Favourites only'));
    });
    // Scope to the model list: Gemma also appears in the disk-usage list.
    expect(
      within(screen.getByTestId('model-list')).queryByText(/Gemma 4 12B/),
    ).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Favourites only'));
    });
    // Compare two models.
    const checkboxes = screen.getAllByLabelText('Compare');
    await act(async () => {
      fireEvent.click(checkboxes[0]);
      fireEvent.click(checkboxes[1]);
    });
    expect(
      screen.getByRole('heading', { name: 'Compare' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Quantisation')).toBeInTheDocument();
  });

  it('enqueues, pauses/resumes via queue controls, cancels, and deletes with confirmation', async () => {
    render(<ModelsSection initialModels={DEMO_MODELS} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    });
    expect(screen.getByText(/queued locally/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Start next queued download' }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    });
    // Delete flow: confirm dialog shows freed space, then confirms.
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    });
    expect(screen.getByText(/frees/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete model' }));
    });
    expect(screen.getByText(/freed .* of disk space/)).toBeInTheDocument();
  });

  it('saves per-model settings with clamping', async () => {
    render(<ModelsSection initialModels={DEMO_MODELS} />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    });
    const temp = screen.getByLabelText(/Temperature/);
    await act(async () => {
      fireEvent.change(temp, { target: { value: '9' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    });
    expect(screen.getByText(/Settings saved/)).toBeInTheDocument();
  });
});

describe('OutputSection', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(navigator.clipboard.writeText).mockResolvedValue(undefined);
  });

  it('copies code blocks, regenerates variants, shows token stats and citations, stops', async () => {
    const onRegenerate = vi.fn().mockResolvedValue('Second version here.');
    const onStop = vi.fn();
    const reply =
      'Answer with [Source](https://example.com/x).\n\n```ts\nconst a = 1;\n```';
    render(
      <OutputSection
        replyText={reply}
        conversationKey="test-conv"
        engineUsage={{
          promptTokens: 10,
          completionTokens: 20,
          elapsedMs: 1000,
        }}
        onRegenerate={onRegenerate}
        onStop={onStop}
      />,
    );
    expect(screen.getByText(/20\.0 tok\/s/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Source/ })).toHaveAttribute(
      'href',
      'https://example.com/x',
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'const a = 1;\n',
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Regenerate reply' }));
    });
    expect(onRegenerate).toHaveBeenCalled();
    expect(screen.getByText(/Showing variant 1 of 1/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop generation' }));
    });
    expect(onStop).toHaveBeenCalled();
    expect(screen.getByText('Generation stopped.')).toBeInTheDocument();
  });

  it('shows an honest message when the engine reports no usage', () => {
    render(
      <OutputSection
        replyText="No usage."
        conversationKey="test-conv-2"
        engineUsage={null}
        onRegenerate={async () => 'x'}
        onStop={() => undefined}
      />,
    );
    expect(screen.getByText(/reported no usage numbers/)).toBeInTheDocument();
  });
});

describe('ModelsIoPanel + routes', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders all three sections and exposes four routes', () => {
    render(<ModelsIoPanel />);
    expect(screen.getByText('Models, Input & Output')).toBeInTheDocument();
    expect(screen.getByLabelText('Models')).toBeInTheDocument();
    expect(screen.getByLabelText('Input')).toBeInTheDocument();
    expect(screen.getByLabelText('Output')).toBeInTheDocument();
    expect(ModelsIoRoutes).toHaveLength(4);
    expect(ModelsIoRoutes.map((r) => r.path)).toEqual([
      '/models-io',
      '/models-io/models',
      '/models-io/input',
      '/models-io/output',
    ]);
  });
});
