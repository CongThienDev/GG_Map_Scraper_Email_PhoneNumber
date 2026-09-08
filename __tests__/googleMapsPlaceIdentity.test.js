const { extractGoogleMapsIdentity, makeLeadKey } = require("../app/utils/googleMapsPlaceIdentity");

describe("Google Maps place identity", () => {
  test("uses a Place ID even when it appears late in a Maps details URL", () => {
    const url =
      "https://www.google.com/maps/place/Lisa/data=!4m10!3m9!1s0x31420e7d58a5ee83:0x497cc16b0c3a727e!5m2!4m1!1i2!8m2!3d15.8!4d108.3!19sChIJg-6lWH0OQjERfnI6DGvBfEk";

    expect(extractGoogleMapsIdentity(url)).toBe("place:ChIJg-6lWH0OQjERfnI6DGvBfEk");
    expect(makeLeadKey({ url })).toBe("place:ChIJg-6lWH0OQjERfnI6DGvBfEk");
  });

  test("falls back to Maps opaque feature IDs without requiring !8m2 adjacency", () => {
    const url = "https://www.google.com/maps/place/X/data=!1s0x31420e7d:0x123!5m2!4m1!1i2";

    expect(extractGoogleMapsIdentity(url)).toBe("feature:0x31420e7d:0x123");
  });

  test("uses website and phone only when Maps has no stable identity", () => {
    expect(
      makeLeadKey({ website: "https://www.Example.com/contact", phone: "+84 935 447 566" })
    ).toBe("domtel:example.com:84935447566");
  });
});
