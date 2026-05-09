# 🔐 Backend Fix: Supabase Auth & Remote Sync 

**Para:** Equipo de Backend / Administrador del Listener Local
**Fecha:** 9 de mayo de 2026
**Asunto:** Error 401 (Unauthorized) en el Listener de Comandos Remotos

---

## 🚨 El Problema (Urgente)

Se ha detectado que el script `remote_listener.py` (o el encargado de procesar la tabla `comandos_remotos`) está fallando con un error **401 Unauthorized** al intentar actualizar el estado de los comandos en Supabase.

### Impacto en el Usuario
Cuando el usuario presiona "Sincronizar" en la App:
1. Se crea un registro en `comandos_remotos` con `status = 'pendiente'`.
2. El listener local lo toma y cambia a `status = 'ejecutando'`.
3. **Falla:** Al terminar (o al fallar el proceso interno), el listener intenta poner `status = 'completado'` o `'error_local'`, pero recibe un **401**.
4. **Resultado:** La App se queda bloqueada mostrando "Sincronizando..." infinitamente porque el registro nunca cambia de estado en la base de datos.

---

## 🛠️ Acciones Requeridas

### 1. Renovar Credenciales de Supabase
El error 401 indica que la `SUPABASE_KEY` (ANON_KEY) o el Token de sesión que usa el script local ha expirado o es inválido para operaciones de escritura.
- **Acción:** Revisar el archivo `.env` o la configuración del widget en la PC local.
- **Verificación:** Asegurarse de que la `ANON_KEY` sea la actual del dashboard de Supabase.

### 2. Verificar Políticas RLS (Si aplica)
Si el listener usa un usuario específico (Auth), verificar que la sesión no haya expirado. Si usa la `ANON_KEY`, verificar que la tabla `comandos_remotos` tenga habilitada la política de `UPDATE` para el rol `anon` o `authenticated` según corresponda.

### 3. Robustez del Listener (Python)
El script no debe dejar comandos en estado `ejecutando` si ocurre una excepción. Se recomienda envolver el proceso en un bloque `try/except/finally`.

**Ejemplo de estructura recomendada:**
```python
try:
    # 1. Marcar como ejecutando
    update_status(comando_id, 'ejecutando')
    
    # 2. Ejecutar la lógica de sincronización
    # run_sync_logic()
    
    # 3. Marcar como completado
    update_status(comando_id, 'completado')
except Exception as e:
    logger.error(f"Error procesando comando {comando_id}: {e}")
    # 4. Asegurar que el estado cambie a error para liberar la App
    try:
        update_status(comando_id, 'error_local')
    except:
        pass # Si falla el 401 aquí, ya sabemos que es el problema raíz
```

---

## 📱 Cambios realizados en la App (Safety Nets)

Para mitigar el impacto de estos fallos de backend, la App móvil ha sido actualizada con:
- **Timeout de 10 minutos:** La App ignorará comandos que lleven más de 10 minutos en `ejecutando`.
- **Detección de demora:** Si un comando tarda > 2 minutos, la App muestra un aviso de "Sincronización demorada".
- **Botón de Reseteo:** Se añadió una opción de "Forzar Reinicio" para que el usuario pueda limpiar el estado localmente si se queda pegado.

**Nota:** Estos cambios en la App son paliativos. La sincronización **no funcionará** hasta que el backend local recupere el acceso de escritura a Supabase.

---

## 🔗 Referencia de Datos
- **Tabla:** `comandos_remotos`
- **Registro de prueba fallido:** ID 8 (Fue reseteado manualmente a `error_local` para desbloquear la App del usuario).
- **Documentación Completa de Regresiones:** Ver [BACKEND_FIX_REQUEST.md](file:///g:/Projects/el-serrucho-go/BACKEND_FIX_REQUEST.md) para otros errores de integridad de datos pendientes.
