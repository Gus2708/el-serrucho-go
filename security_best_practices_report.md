# Reporte de Auditoría de Seguridad y Hardening (Doble Pasada)

**Proyecto**: El Serrucho GO (Expo / React Native / PWA / TypeScript / Supabase)  
**Fecha**: 27 de Agosto de 2026  
**Metodología**: Doble pasada exhaustiva aplicando las skills `better-auth-security-best-practices`, `security-best-practices`, `security-and-hardening` y `test-driven-development`.

---

## 1. Resumen Ejecutivo

Se completó una auditoría exhaustiva en dos pasadas sobre el 100% de la arquitectura, autenticación, flujo de sesiones, almacenamiento, cabeceras HTTP, sanitización de entradas, dependencias y protección contra inyecciones.

El sistema cuenta con una arquitectura base sólida (Supabase Row-Level Security activado en todas las tablas, consultas parametrizadas vía PostgREST y separación de privilegios por roles). No se detectaron fugas de llaves maestras (`service_role`) en el cliente.

Sin embargo, la doble pasada identificó **7 hallazgos de seguridad** que requieren corrección y hardening:
- **1 hallazgo de Severidad ALTA**: Inyección HTML / XSS almacenado en la generación de documentos PDF (`pdfGenerator.ts`).
- **3 hallazgos de Severidad MEDIA**: Ausencia de cabeceras de seguridad HTTP y CSP (`vercel.json` y `+html.tsx`), ejecución de esquemas no seguros en enlaces externos (`ordenes.tsx`), y vulnerabilidades en dependencias (`npm audit`).
- **3 hallazgos de Severidad BAJA-MEDIA**: Falta de sanitización contra Path Traversal en nombres de archivo de storage (`pdfStorage.ts`), ausencia de rate limiting por fuerza bruta en el formulario de login (`login.tsx`), y brechas en el aislamiento de mutaciones secundarias en Modo Demo (`useResolverSolicitud`, `useAlertasSpoof`, `useFallas`, `useAprobaciones`).

---

## 2. Hallazgos Detallados

### [SEC-01] XSS Almacenado en Generador de PDFs (Severidad: ALTA)
- **Ubicación**: `src/utils/pdfGenerator.ts`, líneas 512, 579, 589, 685-689, 702, 709, 813, 821, 857.
- **Impacto**: Si un usuario malicioso o cliente ingresa código HTML/JavaScript en campos como nombre de cliente, RIF, teléfono, dirección, notas de ajuste u observaciones, el payload se inyecta sin sanitizar en el template HTML del PDF. Al previsualizar o imprimir en la PWA (mediante iframe) o en WebKit, el script se ejecuta en el contexto del dominio de la aplicación.
- **Corrección**: Aplicar `escHtml()` a todos los campos textuales derivados del usuario (`cliente.nombre`, `cliente.rif`, `cliente.telefono`, `cliente.direccion`, `creadoPor`, `nota`, `nombre_cliente`, `metodo_pago`, `title`, `docBadge`).

---

### [SEC-02] Ausencia de Cabeceras de Seguridad HTTP y CSP (Severidad: MEDIA)
- **Ubicación**: `vercel.json` (líneas 11-38) y `app/+html.tsx` (líneas 13-55).
- **Impacto**: La PWA carece de cabeceras defensivas contra Clickjacking (`X-Frame-Options: DENY`), protección de MIME sniffing (`X-Content-Type-Options: nosniff`), política de referencia estricta (`Referrer-Policy: strict-origin-when-cross-origin`) y directivas de Content Security Policy (`CSP`). Esto permite que atacantes embeban la app en iframes externos para ataques de clickjacking.
- **Corrección**: Configurar cabeceras de seguridad en `vercel.json` y meta-tags correspondientes en `app/+html.tsx`.

---

### [SEC-03] Ejecución de Esquemas No Seguros en Enlaces de PDF (Severidad: MEDIA)
- **Ubicación**: `app/(tabs)/ordenes.tsx`, línea 789.
- **Impacto**: `Linking.openURL(o.pdf_url)` invoca directamente la URL almacenada sin validar su esquema de protocolo. Si un registro malicioso contiene `javascript:`, `data:` u otro esquema, se ejecutará código arbitrario en el navegador.
- **Corrección**: Validar estrictamente que la URL comience con `https://` o `http://` antes de delegar la apertura al navegador.

---

### [SEC-04] Riesgo de Path Traversal en Subida de Archivos a Storage (Severidad: MEDIA)
- **Ubicación**: `src/lib/pdfStorage.ts`, líneas 15 y 30.
- **Impacto**: El parámetro `fileName` no se sanea contra secuencias de escape de directorio (`../` o caracteres no alfanuméricos) antes de llamar a `supabase.storage.from(BUCKET).upload()`.
- **Corrección**: Aplicar una función de sanitización estricta que elimine cualquier secuencia de directorio o caracter inválido, restringiendo a `[a-zA-Z0-9._-]`.

---

### [SEC-05] Ausencia de Rate Limiting y Manejo de Errores Genéricos en Login (Severidad: BAJA-MEDIA)
- **Ubicación**: `app/(auth)/login.tsx`, líneas 41-47.
- **Impacto**: El formulario de inicio de sesión no implementa un mecanismo de bloqueo temporal tras intentos fallidos consecutivos en el cliente, y expone directamente los mensajes de error del servidor, facilitando la enumeración de credenciales.
- **Corrección**: Implementar limitación por intentos (bloqueo de 30 segundos tras 5 intentos fallidos consecutivos) y presentar mensajes de error genéricos y claros.

---

### [SEC-06] Aislamiento Incompleto de Mutaciones Secundarias en Modo Demo (Severidad: BAJA)
- **Ubicación**: `src/hooks/useResolverSolicitud.ts`, `src/hooks/useAlertasSpoof.ts`, `src/hooks/useFallas.ts`, `src/hooks/useAprobaciones.ts`, `src/hooks/usePresupuestoConfig.ts`.
- **Impacto**: Si un evaluador o reclutador interactúa con botones como "Resolver solicitud", "Marcar revisada" o "Reportar falla", se disparaban mutaciones hacia Supabase sin verificar `isDemoActive()`.
- **Corrección**: Añadir interceptores `isDemoActive()` en todos estos hooks para resolverlos en memoria sin tocar la red.

---

### [SEC-07] Vulnerabilidades Conocidas en Árbol de Dependencias (Severidad: MEDIA)
- **Ubicación**: `package.json` / `package-lock.json`.
- **Impacto**: 29 vulnerabilidades reportadas por `npm audit` (en utilidades como `undici`, `ws`, `nanoid`, `tar`).
- **Corrección**: Ejecutar `npm audit fix` para actualizar parches compatibles sin romper el core de Expo 51.

---

## 3. Plan de Remediación con TDD

Seguiremos el ciclo **Red-Green-Refactor** del skill `test-driven-development`:
1. Escribir pruebas unitarias primero demostrando la vulnerabilidad / comportamiento esperado (RED).
2. Implementar la remediación mínima necesaria para hacer pasar las pruebas (GREEN).
3. Refactorizar y verificar que el 100% de la suite pase limpiamente (REFACTOR).
