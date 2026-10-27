# Migración de la base de datos a Aiven (gratis, 5 GB, sin expiración)

Render elimina sus BD gratis cada 30 días. Aiven no: el plan free de PostgreSQL
tiene 5 GB y no caduca. La app se queda en Render; solo cambia la BD.

## 1. Crear la cuenta en Aiven

1. Entra a https://aiven.io y crea una cuenta (free tier, sin tarjeta).
2. Create service → **PostgreSQL** → plan **Free** → región más cercana.
3. Copia el **Connection string** (formato):
   `postgresql://avnadmin:PASSWORD@host:puerto/defaultdb?sslmode=require`

## 2. Respaldar la BD local

```
database\respaldo_local.bat
```

Crea `database\dumps\ruteo_db_FECHA.sql` (queda en `.gitignore`, no se sube).

## 3. Restaurar en Aiven

```
set AIVEN_DATABASE_URL=postgresql://avnadmin:PASSWORD@host:puerto/defaultdb?sslmode=require
database\restaurar_aiven.bat
```

(O pasa el archivo: `database\restaurar_aiven.bat C:\ruta\dump.sql`)

## 4. Verificar

```
E:\postgre\bin\psql.exe "%AIVEN_DATABASE_URL%" -c "SELECT count(*) FROM clientes;"
```

Debe dar 145.

## 5. Apuntar Render a Aiven

1. Render → tu servicio **ecoruta** → **Environment**.
2. `DATABASE_URL` = el connection string de Aiven (con `?sslmode=require`).
3. Save → redeploy manual.
4. Borra el servicio `ecoruta-db` de Render (ya no se usa; en el Blueprint
   `render.yaml` ya no aparece).

## 6. Rollback

Si algo falla: en Render vuelve a poner el `DATABASE_URL` anterior
(`...render.com/...ecoruta-db...`) y redeploy.

## Notas

- El backend decodifica usuarios/contraseñas con `%2B`, `%40`, etc. y conserva
  el `sslmode` de la URL (Main.parseDatabaseUrl).
- Al arrancar, la app crea el esquema y los usuarios por rol si faltan
  (idempotente); aun así, restaura el dump para conservar clientes/rutas/datos.
- No subas el connection string a git: solo va en la variable de entorno de
  Render y en tu terminal local.
