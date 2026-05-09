import Foundation

struct FiltraCoreVersion: Decodable {
    let app: String
    let apiVersion: String
    let minimumClientVersion: String
}

struct FiltraCoreHealth: Decodable {
    let ok: Bool
}

struct FiltraCoreState: Codable {
    var machines: [Machine]
    var inventory: [InventoryItem]
    var filters: [InstalledFilter]
    var maintenanceRecords: [MaintenanceRecord]
}

struct Machine: Identifiable, Codable, Hashable {
    let id: Int
    var name: String
    var type: String
    var location: String
    var department: String
    var brand: String
    var model: String
    var assetId: String
    var createdAt: String?
}

struct InventoryItem: Identifiable, Codable, Hashable {
    let id: Int
    var name: String
    var category: String
    var stock: Int
    var unitCost: Double
    var reorderLevel: Int
    var lifeMonths: Int
    var createdAt: String?
}

struct InstalledFilter: Identifiable, Codable, Hashable {
    let id: Int
    var machineId: Int
    var productId: Int?
    var productName: String
    var cost: Double
    var lifeMonths: Int
    var psi: Int?
    var psiHistory: [PSIReading]
    var installedAt: String?
    var dueDate: String?
    var status: String
    var createdAt: String?
}

struct PSIReading: Codable, Hashable {
    var date: String?
    var psi: Int
    var source: String?
}

struct MaintenanceRecord: Identifiable, Codable, Hashable {
    let id: Int
    var machineId: Int
    var filterId: Int?
    var type: String
    var date: String?
    var notes: String
    var replacementProductId: Int?
    var replacedFrom: String
    var replacedWith: String
    var previousPsi: Int?
    var correctedPsi: Int?
    var createdAt: String?
}

struct CreateMachineRequest: Encodable {
    var name: String
    var type: String
    var location: String
    var department: String
    var brand: String
    var model: String
    var assetId: String
}

struct CreateInventoryItemRequest: Encodable {
    var name: String
    var category: String
    var stock: Int
    var unitCost: Double
    var reorderLevel: Int
    var lifeMonths: Int
}

struct InstallFilterRequest: Encodable {
    var machineId: Int
    var productId: Int
    var psi: Int?
    var lifeMonths: Int
    var installedAt: String
    var dueDate: String
}

struct UpdatePSIRequest: Encodable {
    var psi: Int
}

struct CreateMaintenanceRequest: Encodable {
    var machineId: Int
    var filterId: Int?
    var type: String
    var date: String
    var notes: String
    var replacementProductId: Int?
    var correctedPsi: Int?
}

enum FiltraCoreAPIError: Error, LocalizedError {
    case invalidResponse
    case serverMessage(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "The server returned an invalid response."
        case .serverMessage(let message):
            return message
        }
    }
}

final class FiltraCoreAPI {
    private let baseURL: URL
    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func health() async throws -> FiltraCoreHealth {
        try await request("api/health")
    }

    func version() async throws -> FiltraCoreVersion {
        try await request("api/version")
    }

    func fetchState() async throws -> FiltraCoreState {
        try await request("api/state")
    }

    func createMachine(_ body: CreateMachineRequest) async throws -> FiltraCoreState {
        try await request("api/machines", method: "POST", body: body)
    }

    func deleteMachine(id: Int) async throws -> FiltraCoreState {
        try await request("api/machines/\(id)", method: "DELETE")
    }

    func createInventoryItem(_ body: CreateInventoryItemRequest) async throws -> FiltraCoreState {
        try await request("api/inventory", method: "POST", body: body)
    }

    func installFilter(_ body: InstallFilterRequest) async throws -> FiltraCoreState {
        try await request("api/filters", method: "POST", body: body)
    }

    func updateFilterPSI(filterId: Int, psi: Int) async throws -> FiltraCoreState {
        try await request("api/filters/\(filterId)/psi", method: "PATCH", body: UpdatePSIRequest(psi: psi))
    }

    func createMaintenanceRecord(_ body: CreateMaintenanceRequest) async throws -> FiltraCoreState {
        try await request("api/maintenance", method: "POST", body: body)
    }

    private func request<Response: Decodable>(_ path: String) async throws -> Response {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return try await send(request)
    }

    private func request<Response: Decodable>(
        _ path: String,
        method: String
    ) async throws -> Response {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return try await send(request)
    }

    private func request<RequestBody: Encodable, Response: Decodable>(
        _ path: String,
        method: String,
        body: RequestBody
    ) async throws -> Response {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(body)
        return try await send(request)
    }

    private func send<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw FiltraCoreAPIError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            if let errorResponse = try? decoder.decode(ServerErrorResponse.self, from: data) {
                throw FiltraCoreAPIError.serverMessage(errorResponse.error)
            }

            throw FiltraCoreAPIError.serverMessage("Request failed with status \(httpResponse.statusCode).")
        }

        return try decoder.decode(Response.self, from: data)
    }
}

private struct ServerErrorResponse: Decodable {
    let error: String
}
