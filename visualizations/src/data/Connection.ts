import QlogConnectionGroup from '@/data/ConnectionGroup';
import { IQlogEventParser, IQlogRawEvent } from '@/data/QlogEventParser';
import * as qlog from '@quictools/qlog-schema';
import Vue from 'vue';

// a single trace
export default class QlogConnection {


    public parent:QlogConnectionGroup;
    public title:string;
    public description:string;

    public eventFieldNames:Array<string> = new Array<string>();
    public commonFields:qlog.ICommonFields = {};
    public configuration:qlog.IConfiguration = { time_offset: "0", time_units: "ms", original_uris: [] };

    public vantagePoint!:qlog.IVantagePoint;

    private events:Array<IQlogRawEvent>;

    private lookupTable:Map<string, Map<string, Array<IQlogRawEvent>>>;

    // The EventParser is needed because qlog events aren't always of the same shape
    // They are also defined as flat arrays, with their member names defined separately (in event_fields)
    // As such, it is not immediately clear which of the indices in the flat array leads to which property (e.g., the timestamp is -usually- at 0, but could be anywhere)
    // So, the eventParser classes deal with this: figure out dynamically which index means what. We can then lookup the index by doing parser.load(event).propertyName
    private eventParser!:IQlogEventParser;

    public constructor(parent:QlogConnectionGroup) {
        this.parent = parent;
        this.title = "NewConnection";
        this.description = "";
        this.events = new Array<IQlogRawEvent>();

        (this.events as any)._isVue = true;

        this.parent.addConnection( this );

        this.lookupTable = new Map<string, Map<string, any>>();
        (this.lookupTable as any)._isVue = true;
    }

    // performs a DEEP clone of this connection
    // NOTE: this is SLOW and should only be used sparingly (mainly added for the sequence diagram)
    public clone():QlogConnection {
        // TODO: maybe find a better way to do this than just JSON.stringify?
        // online they recommend lodash's deepClone
        const output:QlogConnection = new QlogConnection( this.parent );

        output.title = this.title;
        output.description = this.description;
        output.eventFieldNames = this.eventFieldNames.slice();
        output.commonFields = JSON.parse( JSON.stringify(this.commonFields) );
        output.configuration = JSON.parse( JSON.stringify(this.configuration) );
        output.vantagePoint = JSON.parse( JSON.stringify(this.vantagePoint) );
        const events = JSON.parse( JSON.stringify(this.events) );
        (events as any)._isVue = true;
        output.events = events;

        output.eventParser = this.eventParser; // TODO: properly clone this one as well! should work for now, since it's supposed to be static

        return output;
    }

    public setEventParser( parser:IQlogEventParser ){
        // we need to bypass Vue's reactivity here
        // this Connection class is made reactive in ConnectionStore, including the this.eventParser property and its internals
        // however, if we use parseEvent(), this will update the internal .currentEvent property of this.eventParser
        // That update reactively triggers an update...
        // SO: if we would do {{ connection.parseEvent(evt).name }} inside the template (which is like... the main use case here)
        // then we get an infinite loop of reactivity (parseEvent() triggers update, update is rendered, template calls parseEvent() again, etc.)

        // Addittionally, we also don't want the full qlog file to be reactive: just the top-level stuff like the iQlog and the traces
        // the individual events SHOULD NOT be reactive:
        // 1) because they probably won't change
        // 2) because they can be huge and it would get very slow with the way Vue does observability (adding an __ob__ Observer class to EACH object and overriding getters/setters for everything)

        // We looked at many ways of doing this, most of which are discussed in the following issue:
        // https://github.com/vuejs/vue/issues/2637
        // In the end, the only thing that really worked for this specific setup is the ._isVue method
        // We use this both for eventParser and events and for the current setup, it seems to prevent both the infinite loop and event objects being marked as Observable
        // Obviously this is an ugly hack, but since Vue doesn't include a way to do this natively, I really don't see a better way...

        (parser as any)._isVue = true; // prevent the parser from being Vue Reactive
        this.eventParser = parser;
        this.eventParser.init( this );
    }

    // NOTE: only use this directly when connection.parseEvent() is too slow due to Vue's ReactiveGetter on it
    // see SequenceDiagramD3Renderer.calculateConnections for an example of that
    public getEventParser(){
        return this.eventParser;
    }

    public parseEvent( evt:IQlogRawEvent ){
        return this.eventParser.load( evt );
    }

    public setEvents(events:Array<Array<any>>):void {
        (events as any)._isVue = true; // prevent the individual events from being Vue Reactive, see above
        this.events = events;
    }
    public getEvents():Array<Array<any>> { return this.events; }

    public setupLookupTable() {
        if ( this.lookupTable.size !== 0 ){
            return;
        }

        for ( const evt of this.events ){
            const category  = this.parseEvent(evt).category;
            const eventType = this.parseEvent(evt).name;

            if ( !this.lookupTable.has(category) ) {
                this.lookupTable.set( category, new Map<string, Array<IQlogRawEvent>>() );
            }

            const categoryDictionary = this.lookupTable.get(category);
            if ( !categoryDictionary!.has(eventType) ) {
                categoryDictionary!.set( eventType, new Array<IQlogRawEvent>() );
            }

            categoryDictionary!.get(eventType)!.push( evt );
        }

    }

    public lookup(category: qlog.EventCategory | string, eventType: qlog.EventType | string):Array<IQlogRawEvent> {
        if ( this.lookupTable.has(category) && this.lookupTable.get(category)!.has(eventType) ){
            return this.lookupTable.get(category)!.get(eventType)!;
        }
        else {
            return [];
        }
    }
}
