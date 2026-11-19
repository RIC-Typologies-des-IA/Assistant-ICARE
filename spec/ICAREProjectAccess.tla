---------------- MODULE ICAREProjectAccess ----------------
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS Users, Owners0, Members0, LinkHolders0, Ops

ASSUME Owners0 \subseteq Users
ASSUME Members0 \subseteq Users
ASSUME Owners0 \cap Members0 = {}
ASSUME LinkHolders0 \subseteq Users

VARIABLES owners, members, requests, localOps, publishedOps, rejectedOps

vars == <<owners, members, requests, localOps, publishedOps, rejectedOps>>

Init ==
  /\ owners = Owners0
  /\ members = Members0
  /\ requests = [u \in Users |-> "none"]
  /\ localOps = {}
  /\ publishedOps = {}
  /\ rejectedOps = {}

RequestJoin(u) ==
  /\ u \in Users
  /\ u \notin owners \cup members
  /\ requests[u] = "none"
  /\ requests' = [requests EXCEPT ![u] = "pending"]
  /\ UNCHANGED <<owners, members, localOps, publishedOps, rejectedOps>>

OwnerAccept(actor, u) ==
  /\ actor \in owners
  /\ u \in Users
  /\ requests[u] = "pending"
  /\ members' = members \cup {u}
  /\ requests' = [requests EXCEPT ![u] = "accepted"]
  /\ UNCHANGED <<owners, localOps, publishedOps, rejectedOps>>

OwnerReject(actor, u) ==
  /\ actor \in owners
  /\ requests[u] = "pending"
  /\ requests' = [requests EXCEPT ![u] = "rejected"]
  /\ UNCHANGED <<owners, members, localOps, publishedOps, rejectedOps>>

MemberCannotGrant(actor, u) ==
  /\ actor \in members
  /\ u \in Users
  /\ UNCHANGED vars

Revoke(actor, u) ==
  /\ actor \in owners
  /\ u \in members
  /\ members' = members \ {u}
  /\ UNCHANGED <<owners, requests, localOps, publishedOps, rejectedOps>>

DraftOffline(u, op) ==
  /\ u \in Users
  /\ op \in Ops
  /\ op \notin localOps \cup publishedOps \cup rejectedOps
  /\ localOps' = localOps \cup {<<u, op>>}
  /\ UNCHANGED <<owners, members, requests, publishedOps, rejectedOps>>

ReconnectAuthorized(u, op) ==
  /\ <<u, op>> \in localOps
  /\ u \in owners \cup members
  /\ publishedOps' = publishedOps \cup {<<u, op>>}
  /\ localOps' = localOps \ {<<u, op>>}
  /\ UNCHANGED <<owners, members, requests, rejectedOps>>

ReconnectRevoked(u, op) ==
  /\ <<u, op>> \in localOps
  /\ u \notin owners \cup members
  /\ rejectedOps' = rejectedOps \cup {<<u, op>>}
  /\ localOps' = localOps \ {<<u, op>>}
  /\ UNCHANGED <<owners, members, requests, publishedOps>>

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
  /\ localOps \subseteq Users \X Ops
  /\ publishedOps \subseteq Users \X Ops
  /\ rejectedOps \subseteq Users \X Ops

OnlyOwnersCanGrant ==
  \A u \in Users : requests[u] = "accepted" => u \in members

PendingIsNotMembership ==
  \A u \in Users : requests[u] = "pending" => u \notin members

NoUnauthorizedPublication ==
  \A pair \in publishedOps : pair[1] \in owners \cup members

RejectedOperationsAreNotPublished ==
  rejectedOps \cap publishedOps = {}

Spec == Init /\ [][Next]_vars

THEOREM Spec => []TypeOK
THEOREM Spec => []PendingIsNotMembership
THEOREM Spec => []OnlyOwnersCanGrant
THEOREM Spec => []NoUnauthorizedPublication
THEOREM Spec => []RejectedOperationsAreNotPublished
==========================================================
