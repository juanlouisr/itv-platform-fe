/*
 * PseudoStudio - documentation data
 * Powers hover popups, autocomplete docs, and "see docs" on cmd/ctrl+click.
 */
(function () {
  const NS = (window.PseudoStudio = window.PseudoStudio || {});

  // Keyword / language construct documentation (markdown)
  NS.KEYWORD_DOCS = {
    MODULE:
      "Declares a **module** — a named container for `STATE` and `FUNCTION` declarations.\n\n```\nMODULE <Name>\n  STATE:\n    ...\n  FUNCTION <Name>(...): ... END FUNCTION\nEND MODULE\n```",
    STATE:
      "Begins the module-level **state block**. Each line declares a field, optionally with a type:\n\n```\nSTATE:\n  db: Database      // typed field\n  balances: Map     // typed field\n```",
    FUNCTION:
      "Declares a **function**.\n\n```\nFUNCTION <Name>(param1, param2, ...):\n  ...\n  RETURN <value>\nEND FUNCTION\n```",
    END: "Closes the nearest open block: `END IF`, `END FUNCTION`, `END MODULE`.",
    IF: "Conditional branch.\n\n```\nIF <cond> THEN\n  ...\nELSEIF <cond> THEN\n  ...\nELSE\n  ...\nEND IF\n```",
    THEN: "Separates a condition from its body inside `IF` / `ELSEIF`.",
    ELSEIF: "An alternative condition branch within an `IF` statement.",
    ELSE: "The default branch of an `IF` statement.",
    RETURN:
      "Returns a value (or error) from the current function.\n\n```\nRETURN Error(\"insufficient funds\")\nRETURN NIL\n```",
    IS: "Identity / type-check operator. Commonly used as `x IS ERROR` or `x IS NOT ERROR`.",
    NOT: "Logical negation, or part of `IS NOT ERROR`.",
    FOR: "Counting loop.\n\n```\nFOR i = 0 TO n DO\n  ...\nEND FOR\n```",
    WHILE: "Pre-condition loop.\n\n```\nWHILE <cond> DO\n  ...\nEND WHILE\n```",
    DO: "Opens the body of `FOR` / `WHILE`.",
    TO: "Range separator inside `FOR`.",
    BREAK: "Exits the enclosing loop immediately.",
    CONTINUE: "Skips to the next iteration of the enclosing loop.",
    AND: "Logical AND.",
    OR: "Logical OR.",
    XOR: "Logical XOR.",
  };

  // Constant documentation
  NS.CONSTANT_DOCS = {
    NIL: "The empty / null value. Returned to mean *no error* or *no value*.",
    TRUE: "Boolean true.",
    FALSE: "Boolean false.",
    ERROR:
      "The **error sentinel**. An operation that fails returns `ERROR`; check with `x IS ERROR`.",
  };

  // Built-in function documentation (reachable from anywhere)
  NS.BUILTIN_DOCS = {
    Error:
      "**Error(msg)**\n\nConstructs an error value carrying the message `msg`.\n\n```\nRETURN Error(\"insufficient funds\")\n```",
  };

  // Member / property documentation (for result.error, row[0], etc.)
  NS.PROPERTY_DOCS = {
    error:
      "The error carried by a result. Is `NIL` when the operation **succeeded**, or a message string on failure.",
  };

  // Module-level helpers from db.pseudo (db.QUERY_ONE, db.EXEC)
  NS.DB_DOCS = {
    QUERY_ONE:
      "**db.QUERY_ONE(query, ...args)**\n\nRuns a parameterized `SELECT` and returns the **first row's scalar value**.\n\n- `query` — SQL text with `?` placeholders\n- `args` — values bound to the placeholders, in order\n\nReturns the scalar value, or `ERROR` when the query fails / yields no row.\n\n```\nbalance = db.QUERY_ONE(\n  \"SELECT balance FROM accounts WHERE id = ?\", from\n)\n```",
    EXEC:
      "**db.EXEC(query, ...args)**\n\nRuns a parameterized statement that returns no rows (`INSERT` / `UPDATE` / `DELETE`).\n\nReturns a result object whose `.error` is `NIL` on success, or a message on failure.\n\n```\nresult = db.EXEC(\n  \"UPDATE accounts SET balance = ? WHERE id = ?\",\n  balance - amount, from\n)\n```",
  };
})();
