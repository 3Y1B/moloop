import type { ChatProvider } from './providers';
import type { ResponsesOptions } from './responses';

export type MobilizationModelEnvironment = {
  MOBILIZATION_MODEL?: string;
  MOBILIZATION_SERVICE_TIER?: string;
  MOBILIZATION_REASONING_EFFORT?: string;
};
export type MobilizationServiceTier = NonNullable<ResponsesOptions['serviceTier']>;
export type MobilizationReasoningEffort = 'medium' | 'low';
export type MobilizationModelReadiness = {
  ready: boolean;
  model: string;
  missing: string[];
  /** Requested tier, not a claim about the tier the provider actually serves. */
  serviceTier?: MobilizationServiceTier;
  /** Present only after scoped configuration is valid; omission defaults to medium, not global chat reasoning. */
  reasoningEffort?: MobilizationReasoningEffort;
};
export type MobilizationProvider = ChatProvider & {
  serviceTier?: MobilizationServiceTier;
  reasoningEffort: MobilizationReasoningEffort;
};

/** Never echo configuration values, credentials, endpoints or untrusted provider messages. */
export class MobilizationModelConfigurationError extends Error {
  readonly code = 'invalid_mobilization_configuration';
  constructor(readonly field: keyof MobilizationModelEnvironment | 'provider', message?: string) {
    super(message ?? (field === 'MOBILIZATION_MODEL'
      ? 'MOBILIZATION_MODEL must be a nonempty model identifier with at most 128 characters.'
      : field === 'MOBILIZATION_SERVICE_TIER'
        ? 'MOBILIZATION_SERVICE_TIER must be default or fast; omit it to retain the provider project policy.'
        : field === 'MOBILIZATION_REASONING_EFFORT'
          ? 'MOBILIZATION_REASONING_EFFORT must be medium or low; omit it to use medium.'
          : 'Mobilization requires a usable structured-model provider configuration.'));
    this.name = 'MobilizationModelConfigurationError';
  }
}

/** Pure scope selection: model/tier inherit, reasoning defaults to medium; malformed values never fall back. */
export function resolveMobilizationModelConfiguration(
  base: { readiness: Pick<MobilizationModelReadiness, 'ready' | 'model' | 'missing'>; providers: readonly ChatProvider[] },
  environment: MobilizationModelEnvironment,
): { readiness: MobilizationModelReadiness; providers: MobilizationProvider[] } {
  const model = environment.MOBILIZATION_MODEL?.trim();
  if (model != null && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model))
    throw new MobilizationModelConfigurationError('MOBILIZATION_MODEL');
  const tier = environment.MOBILIZATION_SERVICE_TIER?.trim();
  if (tier != null && tier !== 'default' && tier !== 'fast')
    throw new MobilizationModelConfigurationError('MOBILIZATION_SERVICE_TIER');
  const reasoningEffort = environment.MOBILIZATION_REASONING_EFFORT?.trim() ?? 'medium';
  if (reasoningEffort !== 'medium' && reasoningEffort !== 'low')
    throw new MobilizationModelConfigurationError('MOBILIZATION_REASONING_EFFORT');
  const providers = base.providers.map((provider): MobilizationProvider => ({ ...provider,
    ...(model == null ? {} : { model }), ...(tier == null ? {} : { serviceTier: tier }),
    reasoningEffort,
  }));
  const ready = base.readiness.ready && providers.length > 0;
  return {
    providers,
    readiness: { ready, model: model ?? providers[0]?.model ?? base.readiness.model,
      missing: ready ? [] : base.readiness.missing.length ? [...base.readiness.missing] : ['Usable structured-model provider'],
      ...(tier == null ? {} : { serviceTier: tier }), reasoningEffort },
  };
}
