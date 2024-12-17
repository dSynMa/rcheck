grammar RCheck

entry Model:
    //Global section
    (
        //('channel' channel+=Channel (',' channel+=Channel)*)
        (enums+=Enum)
        | ('message-structure' ':' msgStructs+=MsgStruct (',' msgStructs+=MsgStruct)*)
        | ('property-variables' ':' propVars+=PropVar (',' propVars+=PropVar)*)
        | guards+=Guard
    )*
    //Agents and instantiation
    (agents+=Agent)*
    'system' '=' (system+=Instance ('||' system+=Instance)*)
    // Specs
    ('SPEC' specs+=Ltol ';'?)*
    ;

Instance: agent=[Agent] '(' name=ID ',' init=CompoundExpr ')';
Enum:
    'enum' name=ID '{' cases+=Case (',' cases+=Case)* '}';

Case: name=ID;

Guard:
    'guard' name=ID '(' Params? ')' ':=' body=CompoundExpr ';';

Agent:
    'agent' name=ID
    (
        ('local' ':' (locals+=Local (',' locals+=Local)*  ))
        | ('init' ':' init=CompoundExpr)
        | ('relabel' ':' (relabels+=Relabel)+)
        | ('receive-guard' ':' recvguard=CompoundExpr)
    )*
    'repeat' ':' repeat=Choice
    ;

Relabel: var=[PropVar] '<-' CompoundExpr;

Choice: 
    left=Sequence ({infer Choice.left=current} '+' right=Sequence)*;

Sequence:
    left=BaseProcess ({infer Sequence.left=current} ';' right=BaseProcess)*;

BaseProcess: 
    Send | Receive | Get | Supply | '(' Choice ')' | Rep;

Rep:
    'rep' process=Choice;

fragment CmdHeader: (name=ID ':')? '{' psi=CompoundExpr '}';
fragment Update: '[' (update+=Assign (',' update+=Assign)*)? ']';
fragment Data: '(' (data+=Assign (',' data+=Assign)*)? ')';

Send:
    CmdHeader chanExpr=ChannelExpr '!' sendGuard=CompoundExpr Data Update;
Receive: 
    CmdHeader chanExpr=ChannelExpr '?' Update;
Get: 
    CmdHeader op='GET@' '(' where=LocationExpr ')' Update ;
Supply: 
    CmdHeader op='SUPPLY@' '(' where=SupplyLocationExpr ')' Data Update ;

type Command = Send | Receive | Get | Supply;
type Process = BaseProcess | Rep | Sequence | Choice;

Assign: left=[Target] ':=' right=CompoundExpr;

ChannelExprRef: Channel | Local;
ChannelExpr: (channel=[ChannelExprRef] | bcast = '*');
LocationExprRef: Instance | Local;
LocationExpr: (location=[LocationExprRef]);
SupplyLocationExpr: (location=[LocationExprRef] | self="SELF" | any="ANY");

//fragment TypedDeclaration: 
//    name=ID ':' (builtinType=('bool'|'int'|'channel'|'location') | customType=[Enum] | rangeType=Range);

fragment TypedDeclaration: 
    name=ID ':' (builtinType=('bool'|'int'|'location') | customType=[Enum] | rangeType=Range);


Range: lower=INT '..' upper=INT;

fragment Params:
    params+=Param (',' params+=Param)* ;

Target: Local | Channel | Case | Param | MsgStruct | PropVar | Send | Receive | Get | Supply | Instance;

Local: TypedDeclaration;
Channel: name=ID;
Param: TypedDeclaration;
MsgStruct: TypedDeclaration;
PropVar: TypedDeclaration;


CompoundExpr:
    left=Comparison ({infer CompoundExpr.left=current} operator=('&'|'|'|'->'|'U'|'R'|'W') right=Comparison)*;

Comparison:
    left=AddSub ({infer Comparison.left=current} operator=('<'|'<='|'>'|'>='|'='|'!='|'==') right=AddSub)?;

AddSub:
    MulDiv ({infer BinExpr.left=current} operator=('+' | '-') right=MulDiv)*;

MulDiv:
    BaseExpr ({infer BinExpr.left=current} operator=('*' | '/') right=BaseExpr)*;

Qualifier : Instance | LtolQuant;

BaseExpr:
    '(' CompoundExpr ')'
    | {infer AutomatonState} instance=[Instance] '-automaton-state'
    | {infer QualifiedRef} instance=[Qualifier] '-' variable=[Target]
    | {infer Ref} variable=[Target]
    | {infer PropVarRef} variable=[PropVar:PV]
    | {infer UMinus} '-' expr=BaseExpr
    | {infer Neg} '!' expr=BaseExpr
    | {infer Ref} currentChannel='chan'
    | {infer Broadcast} value="*"
    | {infer NumberLiteral} value=INT
    | {infer BoolLiteral} value=('true'|'false')
    | {infer GuardCall} guard=[Guard] '(' (args+=CompoundExpr (',' args+=CompoundExpr)*)? ')'
    | {infer LtolMod} LtolMod
    | {infer LtolBase} LtolBase
    ;

type Expr = BaseExpr | BinExpr | CompoundExpr | Comparison ;

Ltol: (quants+=LtolQuant)* expr=CompoundExpr;

LtolQuant: op=('forall'|'exists') name=ID ':' (builtinType='Agent' | kinds+=[Agent] ('|' kinds+=[Agent])*) '.';

LtolMod infers Ltol:
    {infer Finally} 'F' expr=CompoundExpr
    | {infer Globally} 'G' expr=CompoundExpr
    | {infer Next} 'X' expr=CompoundExpr
    ;

LtolBase infers Ltol:
    {infer Diamond} '<<' obs=Obs '>>' expr=CompoundExpr
    | {infer Box} '[[' obs=Obs ']]' expr=CompoundExpr
    ;

Obs: CompoundObs;
CompoundObs infers Obs:
    BaseObs ({infer BinObs.left=current} operator=('&'|'|'|'->'|'<->') right=BaseObs)*;

BaseObs : LiteralObs | ChannelObs | SenderObs | ForallObs | ExistsObs;
LiteralObs: value=('true'|'false'); 
ChannelObs: 'chan' ('=='|'='|'!=') (chan=ID | chan='*');
SenderObs: 'sender' ('=='|'='|'!=') sender=ID;
ForallObs: 'forall' '(' (pred=CompoundExpr) ')';
ExistsObs: 'exists' '(' (pred=CompoundExpr) ')';


hidden terminal WS: /\s+/;
terminal PV: /@([_a-zA-Z][\w_]*)/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal INT returns number: /[0-9]+/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
