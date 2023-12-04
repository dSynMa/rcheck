grammar RCheck

entry Model:
    //Global section
    (
        ('channels' ':' channels+=Channel (',' channels+=Channel)*)
        | (enums+=Enum)
        | ('message-structure' ':' msgStructs+=MsgStruct (',' msgStructs+=MsgStruct)*)
        | ('communication-variables' ':' commVars+=CommVar (',' commVars+=CommVar)*)
        | guards+=Guard
    )*
    //Agents and instantiation
    (agents+=Agent)*
    'system' '=' (system+=Instance ('|' system+=Instance)*)
    // Specs
    ('SPEC' specs+=Ltol ';')*
    ;

Instance: agent=[Agent] '(' name=ID ',' init=Expr ')';
Enum:
    'enum' name=ID '{' cases+=Case (',' cases+=Case)* '}';

Case infers TypedDecl: name=ID;

Guard:
    'guard' name=ID '(' Params? ')' ':=' Expr ';';

Agent:
    'agent' name=ID
    (
        ('local' ':' (locals+=Local (',' locals+=Local)*  ))
        | ('init' ':' init=Expr)
        | ('relabel' ':' (relabels+=Relabel)+)
        | ('receive-guard' ':' Expr)
    )*
    'repeat' ':' repeat=Process
    ;

Relabel: var=[TypedDecl] '<-' Expr;

Process: Choice;

Choice infers Process: 
    left=Sequence ({infer BinProcess.left=current} '+' right=Sequence)*;

Sequence infers Process:
    left=BaseProcess ({infer BinProcess.left=current} ';' right=BaseProcess)*;

BaseProcess infers Process: 
    Send | Receive | '(' Process ')' | {infer Rep} 'rep' Process;

fragment CmdHeader:
    (name=ID ':')? '{' psi=Expr '}' chanExpr=ChannelExpr;

Send infers Process: 
    {infer Command} CmdHeader '!' 
    sendGuard=Expr
    '(' (data+=Assign (',' data+=Assign)*)? ')'
    '[' (update+=Assign (',' update+=Assign)*)? ']';

Receive infers Process: 
    {infer Command} CmdHeader '?'
    '[' (update+=Assign (',' update+=Assign)*)? ']';

Assign: left=[TypedDecl] ':=' right=Expr;

ChannelExpr: expr=(ID|"*");

fragment TypedDeclaration: 
    name=ID ':' (builtinType=('bool'|'int'|'channel') | customType=[Enum]);

fragment Params:
    params+=Param (',' params+=Param)* ;

Target: Local | Channel | Param | MsgStruct | CommVar | Send | Receive;

Local infers TypedDecl: TypedDeclaration;
Channel infers TypedDecl: name=ID;
Param infers TypedDecl: TypedDeclaration;
MsgStruct infers TypedDecl: TypedDeclaration;
CommVar infers TypedDecl: TypedDeclaration;

Expr: Compound;

Compound infers Expr:
    left=Comparison ({infer BinExpr.left=current} operator=('&'|'|'|'&&'|'||') right=Comparison)*;

Comparison infers Expr:
    left=AddSub ({infer BinExpr.left=current} operator=('<'|'<='|'>'|'>='|'=='|'!='|'=') right=AddSub)?;

AddSub infers Expr:
    MulDiv ({infer BinExpr.left=current} operator=('+' | '-') right=MulDiv)*;

MulDiv infers Expr:
    BaseExpr ({infer BinExpr.left=current} operator=('*' | '/') right=BaseExpr)*;

BaseExpr infers Expr:
    '(' Expr ')'
    | {infer AutomatonState} instance=[Instance] '-automaton-state'
    | {infer QualifiedRef} instance=[Instance] '-' variable=[Target]
    | {infer Ref} variable=[TypedDecl]
    | {infer CommVarRef} '@' variable=[TypedDecl]
    | {infer UMinus} '-' expr=BaseExpr
    | {infer Neg} '!' expr=BaseExpr
    | {infer Ref} currentChannel='channel'
    | {infer Broadcast} value="*"
    | {infer NumberLiteral} value=INT
    | {infer BoolLiteral} value=('TRUE' | 'FALSE'| 'true'|'false')
    | {infer GuardCall} guard=[Guard] '(' (args+=Expr (',' args+=Expr)*)? ')'
    ;

Ltol: LtolCompound;

LtolCompound infers Ltol:
    LtolMod ({infer BinLtol.left=current} operator=('&'|'|'|'&&'|'||'|'->'|'<->') right=LtolMod)*;

LtolMod infers Ltol:
    LtolBase ({infer BinLtol.left=current} operator=('U'|'R'|'W') right=LtolBase)*
    | {infer Finally} 'F' phi=LtolBase
    | {infer Globally} 'G' phi=LtolBase
    | {infer Next} 'X' phi=LtolBase
    ;

LtolBase infers Ltol:
    {infer Diamond} '<' obs=Obs '>' phi=Ltol
    | {infer Box} '[' obs=Obs ']' phi=Ltol
    | {infer Predicate} Expr
    | '(' Ltol ')'
    ;

Obs:
    {infer LiteralObs} value=('TRUE' | 'FALSE'| 'true'|'false')
    | {infer ChannelObs} 'channel' '==' name=ID
    | {infer SenderObs} 'sender' '==' name=ID
    ;


hidden terminal WS: /\s+/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal INT returns number: /[0-9]+/;
terminal STRING: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
