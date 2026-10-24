import { Type } from 'typebox';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

/** Test-only provider: deterministic local completions, never a model/network call. */
export default function (pi) {
  const probe = globalThis.__piBrokerProbe;
  probe.api = pi;
  pi.registerTool({ name: 'fixture_pause', label: 'Fixture pause', description: 'Local deterministic pending tool',
    parameters: Type.Object({}),
    async execute() { probe.toolStarted = true; await new Promise(resolve => { probe.finishTool = resolve; });
      return { content: [{ type: 'text', text: 'Local tool completed' }], details: { fake: true } }; } });
  pi.on('session_start', (_event, ctx) => { probe.context = ctx; probe.starts.push(ctx.sessionManager.getSessionId()); });
  pi.on('session_shutdown', async () => { if (probe.onShutdown) await probe.onShutdown(); });
  pi.registerProvider('broker-fixture', {
    api: 'broker-fixture', apiKey: 'local-no-model', baseUrl: 'http://127.0.0.1/no-network',
    models: [{ id: 'fixture', name: 'Local deterministic fixture', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1000 }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const output = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'pending', timestamp: Date.now() };
      const call = { messages: structuredClone(context.messages), signal: options?.signal, finished: false,
        finishTool() { output.content = [{ type: 'toolCall', id: 'fixture-call-1', name: 'fixture_pause', arguments: {} }];
          output.stopReason = 'toolUse'; call.finished = true; stream.push({ type: 'done', reason: 'toolUse', message: output }); stream.end(); },
        finish(text) { output.content = [{ type: 'text', text }]; output.stopReason = 'stop'; call.finished = true;
          stream.push({ type: 'done', reason: 'stop', message: output }); stream.end(); } };
      probe.calls.push(call);
      stream.push({ type: 'start', partial: output });
      options?.signal?.addEventListener('abort', () => {
        if (call.finished) return; output.stopReason = 'aborted'; output.errorMessage = 'fixture aborted';
        stream.push({ type: 'error', reason: 'aborted', error: output }); stream.end();
      }, { once: true });
      return stream;
    },
  });
}
