/**
 * Route table for the Models / Input / Output feature set.
 *
 * The parent mounts these routes (e.g. under `/models-io/*`) — this module
 * owns no router and edits no existing route table. Each entry is a plain
 * `{ path, element }` record so the parent can mount it with React Router,
 * wouter, or a manual hash switch, whichever the app already uses.
 */

import type { ReactElement } from 'react';
import { ModelsIoPanel } from './ModelsIoPanel';
import { ModelsSection, getInferenceParamsForModel } from './ModelsSection';
import { InputSection } from './InputSection';
import { OutputSection } from './OutputSection';
import { DEMO_MODELS } from './ModelsIoPanel';

export interface ModelsIoRoute {
  path: string;
  label: string;
  element: ReactElement;
}

export const ModelsIoRoutes: ModelsIoRoute[] = [
  {
    path: '/models-io',
    label: 'Models, Input & Output',
    element: <ModelsIoPanel />,
  },
  {
    path: '/models-io/models',
    label: 'Models',
    element: <ModelsSection initialModels={DEMO_MODELS} />,
  },
  {
    path: '/models-io/input',
    label: 'Input',
    element: (
      <InputSection
        modelVision={false}
        onInsertText={() => undefined}
        onAttachFile={() => undefined}
      />
    ),
  },
  {
    path: '/models-io/output',
    label: 'Output',
    element: (
      <OutputSection
        replyText="Hello — this is the current assistant reply."
        conversationKey="modelsio-panel"
        engineUsage={null}
        onRegenerate={async () => 'Hello — this is a regenerated reply.'}
        onStop={() => undefined}
      />
    ),
  },
];

export { getInferenceParamsForModel };
