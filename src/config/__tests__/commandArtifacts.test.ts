import { describe, expect, it } from 'vitest';

import {
  renderCommandsMarkdown,
  renderSlashCommandPromptAppendix,
} from '../commandArtifacts';
import checkedInCommandsMarkdown from '../../../docs/commands.md?raw';
import checkedInPromptAppendix from '../../../src-tauri/prompts/generated/slash_commands.txt?raw';

describe('generated command artifacts', () => {
  it('renders docs markdown that matches the checked-in file', () => {
    expect(renderCommandsMarkdown()).toBe(checkedInCommandsMarkdown);
  });

  it('renders prompt appendix that matches the checked-in file', () => {
    expect(renderSlashCommandPromptAppendix()).toBe(checkedInPromptAppendix);
  });

  it('includes /search in both generated artifacts', () => {
    expect(renderCommandsMarkdown()).toContain('## /search');
    expect(renderSlashCommandPromptAppendix()).toContain('/search:');
  });

  it('never gates /search on the built-in engine (Ollama parity)', () => {
    // Regression guard: the search policy the model reads must not claim
    // search needs the built-in engine. Search is a tool, not inference,
    // and runs on the built-in engine and Ollama alike.
    const appendix = renderSlashCommandPromptAppendix();
    expect(appendix).not.toMatch(/needs the built-in engine/i);
    expect(appendix).not.toMatch(/switch to built-in/i);
    expect(renderCommandsMarkdown()).not.toMatch(/needs the built-in engine/i);
  });

  it('explicitly teaches the model how to answer slash-command questions', () => {
    const appendix = renderSlashCommandPromptAppendix();

    expect(appendix).toContain(
      "These are Veilura's only built-in slash commands:",
    );
    expect(appendix).toContain(
      'If the user asks what slash commands are available, what built-in commands exist, or how to use them, answer with the slash-command list below.',
    );
    expect(appendix).toContain(
      'Do not answer about generic tools, tool availability, or function calling.',
    );
  });
});
