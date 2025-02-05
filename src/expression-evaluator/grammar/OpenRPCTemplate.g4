grammar OpenRPCTemplate;

// Parser Rules
template: (TEXT | reference)*;

reference: '${' expression '}';

expression
    : literal                                                      # literalExpr
    | referencePath                                               # referenceExpr
    | expression operator expression                              # binaryExpr
    | '(' expression ')'                                          # parenExpr
    ;

literal
    : STRING_LITERAL                                              # stringLiteral
    | NUMBER                                                      # numberLiteral
    | BOOLEAN                                                     # booleanLiteral
    | objectLiteral                                              # objectLit
    ;

objectLiteral: '{' (propertyAssignment (',' propertyAssignment)*)? '}';

propertyAssignment: IDENTIFIER ':' expression;

referencePath: IDENTIFIER ('.' IDENTIFIER)* arrayAccess*;

arrayAccess: '[' expression ']';

operator
    : '+' | '-' | '*' | '/' | '%'                                // arithmetic
    | '==' | '===' | '!=' | '!==' | '>' | '>=' | '<' | '<='     // comparison
    | '&&' | '||'                                                // logical
    | '??'                                                       // nullish coalescing
    ;

// Lexer Rules
BOOLEAN: 'true' | 'false';
NUMBER: [0-9]+ ('.' [0-9]+)?;
STRING_LITERAL: ('"' (~["])* '"') | ('\'' (~['])* '\'');
IDENTIFIER: [a-zA-Z_$][a-zA-Z0-9_$]* | STRING_LITERAL;

TEXT: ~[$]+ | '$' ~[{];                                          // Any text not part of a reference

// Skip whitespace between tokens
WS: [ \t\r\n]+ -> skip; 