---------------- MODULE ICAREProjectAccess ----------------
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS Users, Owners0, Members0, Ops

ASSUME Owners0 \subseteq Users
ASSUME Members0 \subseteq Users
ASSUME Owners0 \cap Members0 = {}

VARIABLES owners, members, requests, grants, localOps, publishedOps,
          authorizedOps, rejectedOps

vars == <<owners, members, requests, grants, localOps, publishedOps,
          authorizedOps, rejectedOps>>

Init ==
  /\ owners = Owners0
  /\ members = Members0
  /\ requests = [u \in Users |-> "none"]
  /\ grants = {}
  /\ localOps = {}
  /\ publishedOps = {}
  /\ authorizedOps = {}
  /\ rejectedOps = {}

RequestJoin(u) ==
  /\ u \in Users
  /\ u \notin owners \cup members
  /\ requests[u] = "none"
  /\ requests' = [requests EXCEPT ![u] = "pending"]
  /\ UNCHANGED <<owners, members, grants, localOps, publishedOps,
                 authorizedOps, rejectedOps>>

OwnerAccept(actor, u) ==
  /\ actor \in owners
  /\ u \in Users
  /\ requests[u] = "pending"
  /\ members' = members \cup {u}
  /\ requests' = [requests EXCEPT ![u] = "accepted"]
  /\ grants' = grants \cup {<<actor, u>>}
  /\ UNCHANGED <<owners, localOps, publishedOps, authorizedOps, rejectedOps>>

OwnerReject(actor, u) ==
  /\ actor \in owners
  /\ requests[u] = "pending"
  /\ requests' = [requests EXCEPT ![u] = "rejected"]
  /\ UNCHANGED <<owners, members, grants, localOps, publishedOps,
                 authorizedOps, rejectedOps>>

MemberCannotGrant(actor, u) ==
  /\ actor \in members
  /\ u \in Users
  /\ UNCHANGED vars

Revoke(actor, u) ==
  /\ actor \in owners
  /\ u \in members
  /\ members' = members \ {u}
  /\ UNCHANGED <<owners, requests, grants, localOps, publishedOps,
                 authorizedOps, rejectedOps>>

DraftOffline(u, op) ==
  /\ u \in Users
  /\ op \in Ops
  /\ <<u, op>> \notin localOps \cup publishedOps \cup rejectedOps
  /\ localOps' = localOps \cup {<<u, op>>}
  /\ UNCHANGED <<owners, members, requests, grants, publishedOps,
                 authorizedOps, rejectedOps>>

ReconnectAuthorized(u, op) ==
  /\ <<u, op>> \in localOps
  /\ u \in owners \cup members
  /\ publishedOps' = publishedOps \cup {<<u, op>>}
  /\ authorizedOps' = authorizedOps \cup {<<u, op>>}
  /\ localOps' = localOps \ {<<u, op>>}
  /\ UNCHANGED <<owners, members, requests, grants, rejectedOps>>

ReconnectRevoked(u, op) ==
  /\ <<u, op>> \in localOps
  /\ u \notin owners \cup members
  /\ rejectedOps' = rejectedOps \cup {<<u, op>>}
  /\ localOps' = localOps \ {<<u, op>>}
  /\ UNCHANGED <<owners, members, requests, grants, publishedOps,
                 authorizedOps>>

Next ==
  \/ \E u \in Users : RequestJoin(u)
  \/ \E a \in Users, u \in Users : OwnerAccept(a, u)
  \/ \E a \in Users, u \in Users : OwnerReject(a, u)
  \/ \E a \in Users, u \in Users : MemberCannotGrant(a, u)
  \/ \E a \in Users, u \in Users : Revoke(a, u)
  \/ \E u \in Users, op \in Ops : DraftOffline(u, op)
  \/ \E u \in Users, op \in Ops : ReconnectAuthorized(u, op)
  \/ \E u \in Users, op \in Ops : ReconnectRevoked(u, op)

TypeOK ==
  /\ owners \subseteq Users
  /\ members \subseteq Users
  /\ requests \in [Users -> {"none", "pending", "accepted", "rejected"}]
  /\ grants \subseteq Users \X Users
  /\ localOps \subseteq Users \X Ops
  /\ publishedOps \subseteq Users \X Ops
  /\ authorizedOps \subseteq Users \X Ops
  /\ rejectedOps \subseteq Users \X Ops

OnlyOwnersCanGrant ==
  \A grant \in grants : grant[1] \in owners

AcceptedMeansMember ==
  \A u \in Users : requests[u] = "accepted" => u \in members

PendingIsNotMembership ==
  \A u \in Users : requests[u] = "pending" => u \notin members

EveryPublicationWasAuthorized ==
  publishedOps \subseteq authorizedOps

RejectedOperationsAreNotPublished ==
  rejectedOps \cap publishedOps = {}

Spec == Init /\ [][Next]_vars

THEOREM Spec => []TypeOK
THEOREM Spec => []OnlyOwnersCanGrant
THEOREM Spec => []AcceptedMeansMember
THEOREM Spec => []PendingIsNotMembership
THEOREM Spec => []EveryPublicationWasAuthorized
THEOREM Spec => []RejectedOperationsAreNotPublished
==========================================================
