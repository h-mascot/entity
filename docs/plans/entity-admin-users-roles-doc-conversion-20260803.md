# Entity Users/Roles, Document Conversion, and Configurable Admin V1

## Goal
Deliver three vertical slices: durable multi-user RBAC management; non-destructive document type conversion from Doc Hub; and editable persisted runtime-wired settings for every newly added Admin section.

## Approved queue
1. RBAC-ADMIN-V1
2. DOC-CONVERT-V1
3. ADMIN-CONFIG-V1

## Defaults
Principals are human/agent/service account. Roles are viewer/contributor/manager/admin. Grants scope globally or org/team/project plus sensitivity. Conversion creates a new document and preserves source provenance. Principals/grants use domain tables; feature settings use app_settings. Sandbox only.

## Acceptance
Strict RED/GREEN TDD per vertical slice; builds and ctrl:gate; governed Terra review to closure; PR/CI/merge under run authority; sandbox release identity; native browser QA including narrow viewport. Production requires separate explicit approval.
