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

Case: name=ID;

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

Relabel: var=[CommVar] '<-' Expr;

Process: Choice;

Choice infers Process: 
    left=Sequence ({infer BinProcess.left=current} '+' right=Sequence)*;

Sequence infers Process:
    left=BaseProcess ({infer BinProcess.left=current} ';' right=BaseProcess)*;

BaseProcess infers Process: 
    Send | Receive | Get | Supply | '(' Process ')' | {infer Rep} 'rep' Process;

fragment CmdHeader: (name=ID ':')? '{' psi=Expr '}';
fragment Update: '[' (update+=Assign (',' update+=Assign)*)? ']';
fragment Data: '(' (data+=Assign (',' data+=Assign)*)? ')';

Send infers Process: 
    CmdHeader chanExpr=ChannelExpr '!' sendGuard=Expr Data Update;
Receive infers Process: 
    CmdHeader chanExpr=ChannelExpr '?' Update;
Get infers Process: 
    CmdHeader 'GET@' '(' where=Expr ')' Update ;
Supply infers Process: 
    CmdHeader 'SUPPLY@' '(' where=Expr ')' Data Update ;

Command: Get|Supply|Send|Receive;

Assign: left=[Target] ':=' right=Expr;

ChannelExprRef: Channel | Local;
ChannelExpr: (channel=[ChannelExprRef] | bcast = '*');

fragment TypedDeclaration: 
    name=ID ':' (builtinType=('bool'|'int'|'channel') | customType=[Enum]);

fragment Params:
    params+=Param (',' params+=Param)* ;

Target: Local | Channel | Case | Param | MsgStruct | CommVar | Command | Instance;

Local: TypedDeclaration;
Channel: name=ID;
Param: TypedDeclaration;
MsgStruct: TypedDeclaration;
CommVar: TypedDeclaration;

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
    | {infer Ref} variable=[Target]
    | {infer CommVarRef} variable=[CommVar:CV]
    | {infer UMinus} '-' expr=BaseExpr
    | {infer Neg} '!' expr=BaseExpr
    | {infer Ref} currentChannel='channel'
    | {infer Self} name='SELF'
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
terminal CV: /@([_a-zA-Z][\w_]*)/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal INT returns number: /[0-9]+/;
terminal STRING: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
