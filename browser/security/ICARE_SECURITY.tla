---------------- MODULE IcareSecurity ----------------
EXTENDS Naturals, FiniteSets, Sequences

CONSTANTS Origins, ApprovedInferenceOrigins

VARIABLES projectStore, sessionSecrets, persistentSecrets,
          approvedPayloads, outbound, userRequestedInference,
          serviceWorkerEnabled

vars == <<projectStore, sessionSecrets, persistentSecrets,
          approvedPayloads, outbound, userRequestedInference,
          serviceWorkerEnabled>>

Init ==
  /\ projectStore = {}
  /\ sessionSecrets = {}
  /\ persistentSecrets = {}
  /\ approvedPayloads = {}
  /\ outbound = {}
  /\ userRequestedInference = FALSE
  /\ serviceWorkerEnabled \in BOOLEAN

CreateOrEditProject(data) ==
  /\ projectStore' = projectStore \cup {data}
  /\ UNCHANGED <<sessionSecrets, persistentSecrets, approvedPayloads,
                 outbound, userRequestedInference, serviceWorkerEnabled>>

SetSessionSecret(secret) ==
  /\ sessionSecrets' = sessionSecrets \cup {secret}
  /\ UNCHANGED <<projectStore, persistentSecrets, approvedPayloads,
                 outbound, userRequestedInference, serviceWorkerEnabled>>

ApproveInferencePayload(payload) ==
  /\ approvedPayloads' = approvedPayloads \cup {payload}
  /\ UNCHANGED <<projectStore, sessionSecrets, persistentSecrets,
                 outbound, userRequestedInference, serviceWorkerEnabled>>

RequestInferenceConsent ==
  /\ userRequestedInference = FALSE
  /\ userRequestedInference' = TRUE
  /\ UNCHANGED <<projectStore, sessionSecrets, persistentSecrets,
                 approvedPayloads, outbound, serviceWorkerEnabled>>

RequestInference(origin, payload) ==
  /\ origin \in ApprovedInferenceOrigins
  /\ payload \in approvedPayloads
  /\ userRequestedInference = TRUE
  /\ outbound' = outbound \cup {<<origin, payload, "inference">>}
  /\ userRequestedInference' = FALSE
  /\ UNCHANGED <<projectStore, sessionSecrets, persistentSecrets,
                 approvedPayloads, serviceWorkerEnabled>>

DisableServiceWorker ==
  /\ serviceWorkerEnabled' = FALSE
  /\ UNCHANGED <<projectStore, sessionSecrets, persistentSecrets,
                 approvedPayloads, outbound, userRequestedInference>>

Next ==
  \/ \E data : CreateOrEditProject(data)
  \/ \E secret : SetSessionSecret(secret)
  \/ \E payload : ApproveInferencePayload(payload)
  \/ RequestInferenceConsent
  \/ \E origin \in ApprovedInferenceOrigins, payload : RequestInference(origin, payload)
  \/ DisableServiceWorker

TypeOK ==
  /\ projectStore \subseteq STRING
  /\ sessionSecrets \subseteq STRING
  /\ persistentSecrets \subseteq STRING
  /\ approvedPayloads \subseteq STRING
  /\ outbound \subseteq (Origins \X STRING \X STRING)
  /\ userRequestedInference \in BOOLEAN
  /\ serviceWorkerEnabled \in BOOLEAN

NoPersistentCredentials == persistentSecrets = {}
InferenceRequiresConsent ==
  \A item \in outbound : item[3] = "inference"
OnlyApprovedPayloadsEgress ==
  \A item \in outbound : item[2] \in approvedPayloads

Spec == Init /\ [][Next]_vars
THEOREM Spec => []TypeOK
THEOREM Spec => []NoPersistentCredentials
THEOREM Spec => []InferenceRequiresConsent
THEOREM Spec => []OnlyApprovedPayloadsEgress
=============================================================================
