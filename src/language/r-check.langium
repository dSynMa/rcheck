grammar RCheck

entry Model:
    //Global section
    (
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

Relabel: var=[PropVar] '<-' expr=CompoundExpr;

Choice: 
    left=Sequence ({infer Choice.left=current} '+' right=Sequence)*;

Sequence:
    left=BaseProcess ({infer Sequence.left=current} ';' right=BaseProcess)*;

BaseProcess: 
    Send | Receive | Get | Supply | '(' Choice ')' | Rep;

Rep:
    'rep' process=Choice;

fragment CmdHeader: (name=ID ':')? '{' psi=CompoundExpr '}';
fragment Update: '[' (update+=UpdateAssign (',' update+=UpdateAssign)*)? ']';
fragment Data: '(' (data+=MessageAssign (',' data+=MessageAssign)*)? ')';

Send:
    CmdHeader chanExpr=ChannelExpr '!' sendGuard=CompoundExpr Data Update;
Receive: 
    CmdHeader chanExpr=ChannelExpr '?' Update;
Get: 
    CmdHeader op='GET@' '(' where=GetLocationExpr ')' Data Update ;
Supply: 
    CmdHeader op='SUPPLY@' '(' where=SupplyLocationExpr ')' Data Update ;

type Command = Send | Receive | Get | Supply;
type Process = BaseProcess | Rep | Sequence | Choice;

type Assign = MessageAssign | UpdateAssign ;
MessageAssign: left=[MsgStruct] ':=' right=CompoundExpr;
UpdateAssign: left=[Local] ':=' right=CompoundExpr;

type ChannelExprRef = Case | Local;
ChannelExpr: (channel=[ChannelExprRef] | bcast = '*');
type LocationExprRef = Local;
SupplyLocationExpr: (location=[LocationExprRef] | myself="myself" | any="any");
GetLocationExpr: predicate=CompoundExpr;


fragment TypedDeclaration: 
    name=ID ':' (builtinType=('bool'|'int'|'location') | customType=[Enum] | rangeType=Range);
    // name=ID ':' (builtinType=('bool'|'int'|'location') | customType=[Enum] | rangeType=Range | notfound=ID);


Range: lower=INT '..' upper=INT;

fragment Params:
    params+=Param (',' params+=Param)* ;

type Target = Local | Case | Param | MsgStruct | PropVar | Send | Receive | Get | Supply | Instance;

Local: TypedDeclaration;
Param: TypedDeclaration;
MsgStruct: TypedDeclaration;
PropVar: TypedDeclaration;

CompoundExpr:
    AddSub;

Logical infers CompoundExpr:
    Comparison ({infer BinExpr.left=current} operator=('&'|'|'|'->'|'U'|'R'|'W') right=Comparison)*;

Comparison infers CompoundExpr:
    BaseExpr ({infer BinExpr.left=current} operator=('<'|'<='|'>'|'>='|'='|'!='|'==') right=BaseExpr)?;

AddSub infers CompoundExpr:
    MulDiv ({infer BinExpr.left=current} operator=('+' | '-') right=MulDiv)*;

MulDiv infers CompoundExpr:
    Logical ({infer BinExpr.left=current} operator=('*' | '/') right=Logical)*;

type Qualifier = Instance | LtolQuant;

BaseExpr infers CompoundExpr:
    '(' AddSub ')'
    | {infer AutomatonState} instance=[Instance] '-automaton-state'
    | {infer QualifiedRef} instance=[Qualifier] '-' variable=[Target]
    | {infer Ref} variable=[Target]
    | {infer PropVarRef} variable=[PropVar:PV]
    | {infer UMinus} operator='-' expr=BaseExpr
    | {infer Neg} operator='!' expr=BaseExpr
    | {infer ChannelRef} currentChannel='chan'
    | {infer Myself} myself='myself'
    | {infer Broadcast} value="*"
    | {infer NumberLiteral} value=INT
    | {infer BoolLiteral} value=('true'|'false')
    | {infer GuardCall} guard=[Guard] '(' (args+=CompoundExpr (',' args+=CompoundExpr)*)? ')'
    | {infer LtolMod} LtolMod
    | {infer LtolBase} LtolBase
    ;

Ltol: (quants+=LtolQuant)* expr=CompoundExpr;

LtolQuant: op=('forall'|'exists') name=ID ':' (anyKind='Agent' | kinds+=[Agent] ('|' kinds+=[Agent])*) '.';

LtolMod infers Ltol:
    {infer Finally} operator='F' expr=CompoundExpr
    | {infer Globally} operator='G' expr=CompoundExpr
    | {infer Next} operator='X' expr=CompoundExpr
    ;

LtolBase infers Ltol:
    {infer Diamond} '<<' obs=Obs '>>' expr=CompoundExpr
    | {infer Box} '[[' obs=Obs ']]' expr=CompoundExpr
    ;

Obs: CompoundObs;
CompoundObs infers Obs:
    BaseObs ({infer BinObs.left=current} operator=('&'|'|'|'->'|'<->') right=BaseObs)*;

BaseObs : LiteralObs | ChannelObs | SenderObs | GetterObs | ForallObs | ExistsObs;
LiteralObs: value=('true'|'false'|'p2p');
ChannelObs: 'chan' ('=='|'='|'!=') (chan=[Case] | bcast='*');
SenderObs: 'sender' ('=='|'='|'!=') sender=[Qualifier];
GetterObs: 'getter' ('=='|'='|'!=') getter=[Qualifier];
ForallObs: operator='forall' '(' (expr=CompoundExpr) ')';
ExistsObs: operator='exists' '(' (expr=CompoundExpr) ')';


hidden terminal WS: /\s+/;
terminal PV: /@([_a-zA-Z][\w_]*)/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal INT returns number: /[0-9]+/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
