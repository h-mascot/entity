/**
 * Centralized customer data-plane credential guard (Terra R1).
 *
 * MOUNTED IN PRODUCTION COMPOSITION (`index.ts`) immediately after
 * `createCustomerPrincipalMiddleware` (and the optional service-principal
 * middleware). It is the single enforcement boundary that closes the R1
 * defect: with API auth enabled, the deployment-wide `ENTITY_API_TOKEN`
 * authenticates TRANSPORT only and MUST NOT imply customer/data-plane
 * authority. Every customer data-plane route additionally requires a valid,
 * active, individually revocable `x-entity-access-token` (resolved into
 * `req.entityCustomerPrincipal` by the customer-principal middleware).
 *
 * Invariant (fail-closed, no downgrade):
 *   - API auth DISABLED (local dev): inert. The trusted local-dev path is
 *     preserved unchanged.
 *   - public / control plane: pass through. Public routes bypass the transport
 *     bearer; control routes (the narrow `/api/admin` boundary) retain the
 *     server-trusted principal + their own admin authorization.
 *   - data-plane WITH a valid customer principal: pass through to route-level
 *     tenant/operation authorization.
 *   - data-plane WITHOUT a customer principal (missing / invalid / revoked /
 *     disabled token): DENY 403 `customer_credential_required`. The shared
 *     transport bearer is intentionally NOT customer authority here, so a
 *     bearer-only request never reaches the customer data plane.
 *
 * This guard replaces the prior representative-route guards. It is centralized
 * (one middleware, one classifier) and covers the ENTIRE protected API surface
 * via `classifyRoute`, not a handful of hand-picked routes.
 */
import type { RequestHandler } from 'express';

import { classifyRoute } from '../route-classifier';
import { isApiAuthEnabled } from './api-auth';
import { getCustomerPrincipal } from '../principals/request-context';

export const CUSTOMER_CREDENTIAL_REQUIRED_CODE = 'customer_credential_required';

/**
 * Create the production-mounted data-plane credential guard. Stateless; reads
 * `ENTITY_API_TOKEN`, the request path, and the customer principal attached by
 * `createCustomerPrincipalMiddleware`.
 */
export function createDataPlaneCredentialGuard(): RequestHandler {
  return (req, res, next) => {
    // Local development (no transport auth): preserve the trusted path. The
    // customer credential layer is irrelevant when the whole surface is open.
    if (!isApiAuthEnabled()) {
      return next();
    }

    const plane = classifyRoute(req.path);

    // Public health/version/readiness/clickclack and the static/SPA shell, plus
    // the control-plane (admin/principal/setup/operations), pass through. They
    // are governed by the transport bearer and (for control) the server-trusted
    // principal + their own authorization.
    if (plane !== 'data-plane') {
      return next();
    }

    // Data-plane: a valid, active, individually revocable customer credential
    // is REQUIRED. `req.entityCustomerPrincipal` is attached by the
    // customer-principal middleware only for a resolved active token; an
    // invalid/revoked/disabled token already failed closed (403) there.
    if (getCustomerPrincipal(req)) {
      return next();
    }

    // No customer principal. The shared transport bearer is NOT customer
    // authority. Fail closed, deterministically.
    res.status(403).json({
      error: 'permission denied',
      code: CUSTOMER_CREDENTIAL_REQUIRED_CODE,
      reason: 'customer data-plane access requires a valid x-entity-access-token',
    });
  };
}
