---------------- MODULE IcareSecurity ----------------
EXTENDS Naturals, FiniteSets, Sequences

CONSTANTS Origins, ApprovedInferenceOrigins, LocalOrigin

VARIABLES projectStore, sessionSecrets, persistentSecrets,
          outbound, userRequestedInference, serviceWorkerEnabled

vars == <<projectStore, sessionSecrets, persistentSecrets,
          outbound, userRequestedInference, serviceWorkerEnabled>>

Init ==
  /\ projectStore = {}
  /\ sessionSecrets = {}
  /\ persistentSecrets = {}
  /\ outbound = {}
  /\ userRequestedInference = FALSE
  /\ serviceWorkerEnabled \in BOOLEAN

CreateOrEditProject(data) ==
  /\ projectStore' = projectStore \cup {data}
  /\ UNCHANGED <<sessionSecrets, persistentSecrets, outbound,
                 userRequestedInference, serviceWorkerEnabled>>

SetSessionSecret(secret) ==
  /\ sessionSecrets' = sessionSecrets \cup {secret}
  /\ persistentSecrets' = persistentSecrets
  /\ UNCHANGED <<projectStore, outbound, userRequestedInference,
                 serviceWorkerEnabled>>

RequestInference(origin, payload) ==
  /\ origin \in ApprovedInferenceOrigins
  /\ userRequestedInference = TRUE
  /\ outbound' = outbound \cup {<<origin, payload, "inference">>}
  /\ userRequestedInference' = FALSE
  /\ UNCHANGED <<projectStore, sessionSecrets, persistentSecrets,
                 serviceWorkerEnabled>>

RequestInferenceConsent ==
  /\ userRequestedInference = FALSE
  /\ userRequestedInference' = TRUE
  /\ UNCHANGED <<projectStore, sessionSecrets, persistentSecrets,
                 outbound, serviceWorkerEnabled>>

DisableServiceWorker ==
  /\ serviceWorkerEnabled' = FALSE
  /\ UNCHANGED <<projectStore, sessionSecrets, persistentSecrets,
                 outbound, userRequestedInference>>

Next ==
  \/ \E data : CreateOrEditProject(data)
  \/ \E secret : SetSessionSecret(secret)
  \/ \E origin \in Origins, payload : RequestInference(origin, payload)
  \/ RequestInferenceConsent
  \/ DisableServiceWorker

TypeOK ==
  /\ projectStore \subseteq STRING
  /\ sessionSecrets \subseteq STRING
  /\ persistentSecrets \subseteq STRING
  /\ outbound \subseteq (Origins \X STRING \X STRING)
  /\ userRequestedInference \in BOOLEAN
  /\ serviceWorkerEnabled \in BOOLEAN

NoPersistentCredentials == persistentSecrets = {}
InferenceRequiresConsent ==
  \A item \in outbound : item[3] = "inference"
NoProjectEgress ==
  \A item \in outbound : item[2] \notin projectStore

Spec == Init /\ [][Next]_vars
THEOREM Spec => []TypeOK
THEOREM Spec => []NoPersistentCredentials
THEOREM Spec => []InferenceRequiresConsent
THEOREM Spec => []NoProjectEgress
=============================================================================
