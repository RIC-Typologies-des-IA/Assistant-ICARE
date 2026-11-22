---------------- MODULE IcareEnterpriseGateway ----------------
EXTENDS Naturals, FiniteSets

CONSTANTS GatewayOrigins, ModelAliases, Identities, Payloads, ProviderSecrets

VARIABLES configuredOrigins, authenticatedIdentity, allowedModels,
          serverProviderSecrets, browserProviderSecrets, approvedPayloads,
          outboundRequests, userConsent

vars == <<configuredOrigins, authenticatedIdentity, allowedModels,
          serverProviderSecrets, browserProviderSecrets, approvedPayloads,
          outboundRequests, userConsent>>

Init ==
  /\ configuredOrigins = {}
  /\ authenticatedIdentity = {}
  /\ allowedModels = {}
  /\ serverProviderSecrets = {}
  /\ browserProviderSecrets = {}
  /\ approvedPayloads = {}
  /\ outboundRequests = {}
  /\ userConsent = FALSE

ConfigureGateway(origin, models) ==
  /\ origin \in GatewayOrigins
  /\ models \subseteq ModelAliases
  /\ configuredOrigins' = configuredOrigins \cup {origin}
  /\ allowedModels' = allowedModels \cup models
  /\ UNCHANGED <<authenticatedIdentity, serverProviderSecrets,
                 browserProviderSecrets, approvedPayloads,
                 outboundRequests, userConsent>>

Authenticate(identity) ==
  /\ identity \in Identities
  /\ authenticatedIdentity' = {identity}
  /\ UNCHANGED <<configuredOrigins, allowedModels, serverProviderSecrets,
                 browserProviderSecrets, approvedPayloads,
                 outboundRequests, userConsent>>

StoreProviderSecret(secret) ==
  /\ secret \in ProviderSecrets
  /\ serverProviderSecrets' = serverProviderSecrets \cup {secret}
  /\ UNCHANGED <<configuredOrigins, authenticatedIdentity, allowedModels,
                 browserProviderSecrets, approvedPayloads,
                 outboundRequests, userConsent>>

ApprovePayload(payload) ==
  /\ payload \in Payloads
  /\ approvedPayloads' = approvedPayloads \cup {payload}
  /\ userConsent' = TRUE
  /\ UNCHANGED <<configuredOrigins, authenticatedIdentity, allowedModels,
                 serverProviderSecrets, browserProviderSecrets,
                 outboundRequests>>

SendEnterpriseInference(origin, model, payload) ==
  /\ origin \in configuredOrigins
  /\ authenticatedIdentity # {}
  /\ model \in allowedModels
  /\ payload \in approvedPayloads
  /\ userConsent = TRUE
  /\ outboundRequests' = outboundRequests \cup
       {<<origin, model, payload, CHOOSE identity \in authenticatedIdentity : TRUE>>}
  /\ userConsent' = FALSE
  /\ UNCHANGED <<configuredOrigins, authenticatedIdentity, allowedModels,
                 serverProviderSecrets, browserProviderSecrets,
                 approvedPayloads>>

RevokeIdentity ==
  /\ authenticatedIdentity # {}
  /\ authenticatedIdentity' = {}
  /\ UNCHANGED <<configuredOrigins, allowedModels, serverProviderSecrets,
                 browserProviderSecrets, approvedPayloads,
                 outboundRequests, userConsent>>

Next ==
  \/ \E origin \in GatewayOrigins, models \in SUBSET ModelAliases :
       ConfigureGateway(origin, models)
  \/ \E identity \in Identities : Authenticate(identity)
  \/ \E secret \in ProviderSecrets : StoreProviderSecret(secret)
  \/ \E payload \in Payloads : ApprovePayload(payload)
  \/ \E origin \in GatewayOrigins, model \in ModelAliases, payload \in Payloads :
       SendEnterpriseInference(origin, model, payload)
  \/ RevokeIdentity

TypeOK ==
  /\ configuredOrigins \subseteq GatewayOrigins
  /\ authenticatedIdentity \subseteq Identities
  /\ allowedModels \subseteq ModelAliases
  /\ serverProviderSecrets \subseteq ProviderSecrets
  /\ browserProviderSecrets = {}
  /\ approvedPayloads \subseteq Payloads
  /\ outboundRequests \subseteq
       (GatewayOrigins \X ModelAliases \X Payloads \X Identities)
  /\ userConsent \in BOOLEAN

ProviderSecretsStayServerSide == browserProviderSecrets = {}
GatewayDestinationPinned ==
  \A request \in outboundRequests : request[1] \in configuredOrigins
GatewayModelAllowlisted ==
  \A request \in outboundRequests : request[2] \in allowedModels
GatewayInferenceRequiresIdentity ==
  \A request \in outboundRequests : request[4] \in Identities
GatewayInferenceRequiresConsent ==
  \A request \in outboundRequests : request[3] \in approvedPayloads

Spec == Init /\ [][Next]_vars
THEOREM Spec => []TypeOK
THEOREM Spec => []ProviderSecretsStayServerSide
THEOREM Spec => []GatewayDestinationPinned
THEOREM Spec => []GatewayModelAllowlisted
THEOREM Spec => []GatewayInferenceRequiresIdentity
THEOREM Spec => []GatewayInferenceRequiresConsent
=============================================================================
