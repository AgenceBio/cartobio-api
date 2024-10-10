const { enforceRecord } = require("./middlewares.js");
const { NotFoundApiError } = require("./errors.js");
const { getRecord } = require("./providers/cartobio.js");
const { loadRecordFixture } = require("../test/utils");
const [record] = require("./providers/__fixtures__/records.json");

const reply = {
  code: jest.fn().mockReturnValue({
    send: jest.fn().mockImplementation((val) => val),
  }),
};

describe("enforceRecord()", () => {
  beforeEach(loadRecordFixture);

  test("throws a NotFoundError if record does not exist", async () => {
    const request = {
      params: { recordId: "1ebd72f2-b071-4b8b-84dc-fa621ebd18e7" },
      record: null,
    };

    const hook = enforceRecord({ queryFn: getRecord, param: "recordId" });
    return expect(hook(request, reply)).rejects.toThrow(NotFoundApiError);
  });

  test("known operator and known record", async () => {
    const request = {
      params: { recordId: "054f0d70-c3da-448f-823e-81fcf7c2bf6e" },
      headers: {},
      record: null,
    };

    const hook = enforceRecord({ queryFn: getRecord, param: "recordId" });

    return hook(request, reply).then(() => {
      expect(request.record).toMatchObject({
        record_id: record.record_id,
        version_name: record.version_name,
        numerobio: record.numerobio,
        certification_state: record.certification_state,
        metadata: record.metadata,
      });
    });
  });
});
