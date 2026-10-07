DELETE FROM "profiles" AS p
WHERE p.id <> (
  SELECT q.id FROM "profiles" AS q
  WHERE q.customer_id = p.customer_id
  ORDER BY q.revision DESC, q.created_at DESC
  LIMIT 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_customer_uq" ON "profiles" USING btree ("customer_id");
