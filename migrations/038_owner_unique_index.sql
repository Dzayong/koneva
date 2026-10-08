-- Close the race in provision-owner-operator: SELECT ... FOR UPDATE locks nothing on an empty
-- result set, so two concurrent processes can both INSERT is_owner=true.  The unique partial
-- index makes the database itself enforce at most one Owner row.
CREATE UNIQUE INDEX IF NOT EXISTS operators_single_owner_idx ON operators ((is_owner)) WHERE is_owner;
