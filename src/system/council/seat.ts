// this module defines an auxilliary struct datatype that represents a seat 
// in the council. It is basically a value of a Field with one bit set.
// It is used in proofs to mark the vote of particular seat in a field based
// bit array.

import { Struct, Field, Bool, Gadgets } from "o1js";
import { CouncilMap } from "./data/council-map";

export class Seat extends Struct({
  value: Field,
}) {
    static MAX_VALUE = Field.from(2n ** BigInt(CouncilMap.SEAT_LIMIT));
     
    static fromIndex(index: number | bigint): Seat {
        if (index >= CouncilMap.SEAT_LIMIT) {
            throw new Error('Index out of bounds');
        }
        return new Seat({ value: Field.from(2n ** BigInt(index)) });
    }
    static fromField(field: Field): Seat {
        field.assertLessThan(Seat.MAX_VALUE);
        return new Seat({ value: field });
    }

    toIndex(): number {
        // log2
        return Number(Math.log2(Number(this.value)));
    } 

    assertValid(): void {
        this.value.assertLessThan( Seat.MAX_VALUE);
        const x = this.value;

        x.assertGreaterThan(Field(0));
        let xMinus1 = x.sub(Field(1));

        let andValue = Gadgets.and(x, xMinus1, CouncilMap.SEAT_LIMIT);
        andValue.assertEquals(Field(0));
    }
}

