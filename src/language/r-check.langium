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
    (agents+=Agent)*
    'system' '=' (system+=Instance ('|' system+=Instance))
    ;

Instance: agent=[Agent] '(' name=ID ',' Expr ')';
Enum:
    'enum' name=ID '{' cases+=Case (',' cases+=Case)* '}';

Case infers TypedDecl: name=ID;

Guard:
    'guard' name=ID '(' Params? ')' ':=' Expr ';';

Agent:
    'agent' name=ID
    (
        ('local' ':' (locals+=Local (',' locals+=Local)  ))
        | ('init' ':' Expr)
        | ('relabel' ':' (relabels+=Relabel)+)
        | ('receive-guard' ':' Expr)
    )*
    'repeat' ':' repeat=Process
    ;

Relabel: var=[TypedDecl] '<-' Expr;

Process: Choice;

Choice infers Process: 
    left=Sequence ({infer BinProcess.left=current} '+' right=Sequence);

Sequence infers Process:
    left=BaseProcess ({infer BinProcess.left=current} ';' right=BaseProcess);

BaseProcess infers Process: 
    Send | Receive | '(' Process ')' | {infer Rep} 'rep' Process;

Send infers Process: 
    (label=ID ':')? '<' psi=Expr '>' chanExpr=ChannelExpr '!' 
    sendGuard=Expr
    '(' (data+=Assign (',' data+=Assign)*)? ')'
    '[' (update+=Assign (',' update+=Assign)*)? ']';

Receive infers Process: 
    (label=ID ':')? '<' psi=Expr '>' chanExpr=ChannelExpr '?'
    '[' update+=Assign (',' update+=Assign)* ']';

Assign: left=[TypedDecl] ':=' right=Expr;

ChannelExpr: expr=(ID|"*");

fragment TypedDeclaration: 
    name=ID ':' (builtinType=('bool'|'int'|'channel') | customType=[Enum]);

fragment Params:
    params+=Param (',' params+=Param)* ;

Local infers TypedDecl: TypedDeclaration;
Channel infers TypedDecl: name=ID;
Param infers TypedDecl: TypedDeclaration;
MsgStruct infers TypedDecl: TypedDeclaration;
CommVar infers TypedDecl: TypedDeclaration;

Expr: Compound;

Compound infers Expr:
    left=Comparison ({infer BinExpr.left=current} operator=('&'|'|'|'&&'|'||') right=Comparison)*;

Comparison infers Expr:
    left=AddSub ({infer BinExpr.left=current} operator=('<'|'<='|'>'|'>='|'=='|'!=') right=AddSub)?;

AddSub infers Expr:
    MulDiv ({infer BinExpr.left=current} operator=('+' | '-') right=MulDiv)*;

MulDiv infers Expr:
    BaseExpr ({infer BinExpr.left=current} operator=('*' | '/') right=BaseExpr)*;

BaseExpr infers Expr:
    '(' Expr ')'
    // | {infer ParamRef} param=[Param]
    // | {infer MsgRef} msg=[MsgStruct]
    // | {infer CaseRef} case=[Case]
    | {infer Ref} variable=[TypedDecl]
    | {infer CommVarRef} '@' variable=[TypedDecl]
    | {infer UMinus} '-' expr=BaseExpr
    | {infer Neg} '!' expr=BaseExpr
    | {infer Ref} currentChannel='channel'
    | {infer Broadcast} value="*"
    | {infer NumberLiteral} value=INT
    | {infer BoolLiteral} value=('TRUE' | 'FALSE'| 'true'|'false')
    ;
    //| {infer guardCall} guard=[Guard] '(' (Expr (',' Expr)*)? ')';


hidden terminal WS: /\s+/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal INT returns number: /[0-9]+/;
terminal STRING: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
