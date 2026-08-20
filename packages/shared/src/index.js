"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHealthResponse = exports.API_PREFIX = exports.APP_NAME = void 0;
exports.APP_NAME = 'FunTax';
exports.API_PREFIX = '/api';
const createHealthResponse = (service) => ({
    status: 'ok',
    service,
    timestamp: new Date().toISOString(),
});
exports.createHealthResponse = createHealthResponse;
//# sourceMappingURL=index.js.map